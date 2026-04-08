// digest: parse ChatGPT conversation export JSON → extract knowledge → create brain pages

import { defineCommand } from "citty";
import { resolveDbPath, openDb, migrateDb } from "../core/db.ts";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";

interface ChatGPTMessage {
  author?: { role: string };
  content?: { parts?: string[] };
}

interface ChatGPTConversation {
  title?: string;
  create_time?: number;
  mapping?: Record<string, { message?: ChatGPTMessage }>;
}

function parseConversation(conv: ChatGPTConversation): string {
  const messages: string[] = [];
  const mapping = conv.mapping ?? {};

  for (const node of Object.values(mapping)) {
    const msg = node.message;
    if (!msg) continue;
    const role = msg.author?.role ?? "unknown";
    const parts = msg.content?.parts ?? [];
    const text = parts.filter((p) => typeof p === "string").join("\n").trim();
    if (text) {
      messages.push(`[${role}]: ${text.slice(0, 1500)}`);
    }
  }

  return messages.slice(0, 30).join("\n\n");
}

async function compileConversation(
  title: string,
  text: string
): Promise<Array<{ slug: string; title: string; type: string; content: string }>> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error("✗ ANTHROPIC_API_KEY not set.");
    return [];
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `You are a knowledge compiler. Read this ChatGPT conversation titled "${title}" and extract the most useful learnings as structured knowledge.

For each distinct learning, output a JSON object on its own line:
{"slug":"concepts/X","title":"X","type":"concept","content":"..."}

Types: concept (technical insight), learning (practical how-to), source (reference material).
Slug: lowercase with hyphens, prefixed by type.
Content: 1-3 paragraphs of compiled truth.
Extract 2-5 learnings. Only output valid JSON lines, nothing else.

CONVERSATION:
${text}`,
      },
    ],
  });

  const responseText =
    response.content[0]?.type === "text" ? response.content[0].text : "";
  const results: Array<{ slug: string; title: string; type: string; content: string }> = [];

  for (const line of responseText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.slug && obj.title && obj.content) {
        results.push(obj);
      }
    } catch {}
  }

  return results;
}

export default defineCommand({
  meta: {
    name: "digest",
    description: "Extract knowledge from ChatGPT export JSON into brain pages",
  },
  args: {
    db: { type: "option", description: "Path to brain.db" },
    all: { type: "boolean", description: "Process all conversations (not just top 20)", default: false },
    file: { type: "positional", description: "Path to ChatGPT conversations.json export", required: true },
  },
  async run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const db = openDb(dbPath);
    migrateDb(db);

    const filePath = args.file as string;
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      console.error(`✗ Cannot read file: ${filePath}`);
      process.exit(1);
    }

    let conversations: ChatGPTConversation[];
    try {
      conversations = JSON.parse(raw) as ChatGPTConversation[];
    } catch {
      console.error("✗ Invalid JSON. Expected ChatGPT export format (array of conversations).");
      process.exit(1);
    }

    if (!Array.isArray(conversations)) {
      console.error("✗ Expected an array of conversations.");
      process.exit(1);
    }

    // Sort by recency, take top N
    const sorted = conversations
      .filter((c) => c.title && c.mapping)
      .sort((a, b) => (b.create_time ?? 0) - (a.create_time ?? 0));

    const toProcess = args.all ? sorted : sorted.slice(0, 20);
    console.log(`Processing ${toProcess.length} conversation(s)...`);

    const upsert = db.prepare(`
      INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, content_hash)
      VALUES (?, ?, ?, ?, '', json_object('type', ?, 'tags', json_array('digested')), ?)
      ON CONFLICT(slug) DO UPDATE SET
        compiled_truth = compiled_truth || char(10) || char(10) || '---' || char(10) || char(10) || excluded.compiled_truth,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    `);

    let totalPages = 0;
    for (const conv of toProcess) {
      const convTitle = conv.title ?? "Untitled";
      const hash = createHash("sha256")
        .update(convTitle + String(conv.create_time ?? 0))
        .digest("hex")
        .slice(0, 16);

      const alreadyDone = db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) as n FROM ingest_log WHERE source_ref = ?"
        )
        .get(hash);
      if ((alreadyDone?.n ?? 0) > 0) {
        console.log(`  skip "${convTitle}" (already digested)`);
        continue;
      }

      const text = parseConversation(conv);
      if (!text.trim()) {
        console.log(`  skip "${convTitle}" (empty)`);
        continue;
      }

      process.stdout.write(`  "${convTitle}"...`);
      try {
        const learnings = await compileConversation(convTitle, text);
        if (learnings.length === 0) {
          process.stdout.write(" (no learnings)\n");
          continue;
        }

        for (const l of learnings) {
          upsert.run(l.slug, l.type ?? "concept", l.title, l.content, l.type ?? "concept", hash);
          totalPages++;
        }

        db.prepare(
          `INSERT INTO ingest_log (source_type, source_ref, pages_updated, summary) VALUES ('chatgpt-export', ?, ?, ?)`
        ).run(
          hash,
          JSON.stringify(learnings.map((l) => l.slug)),
          `Digested ${learnings.length} learnings from "${convTitle}"`
        );

        process.stdout.write(` ✓ ${learnings.length} learning(s)\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(` ✗ ${msg}\n`);
      }
    }

    console.log(`\n✓ Done. Created/updated ${totalPages} page(s).`);
  },
});
