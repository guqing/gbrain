// harvest: parse Claude Code session JSONL → extract learnings → create/update brain pages
// Each JSONL line is a conversation turn; we compile the session into structured knowledge

import { defineCommand } from "citty";
import { resolveDbPath, openDb, migrateDb } from "../core/db.ts";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";

interface JournalEntry {
  role?: string;
  type?: string;
  content?: string | Array<{ type: string; text?: string }>;
  message?: { role: string; content: string | Array<{ type: string; text?: string }> };
}

function extractTextFromContent(
  content: string | Array<{ type: string; text?: string }> | undefined
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

function parseJSONL(raw: string): JournalEntry[] {
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JournalEntry];
      } catch {
        return [];
      }
    });
}

function sessionToText(entries: JournalEntry[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    const role = e.role ?? e.message?.role ?? e.type ?? "unknown";
    const content = e.content ?? e.message?.content;
    const text = extractTextFromContent(content as string | Array<{ type: string; text?: string }>);
    if (text.trim()) {
      parts.push(`[${role}]: ${text.slice(0, 2000)}`);
    }
  }
  return parts.slice(0, 50).join("\n\n"); // first 50 turns, truncated
}

async function compileSession(sessionText: string): Promise<
  Array<{ slug: string; title: string; type: string; content: string }>
> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error("✗ ANTHROPIC_API_KEY not set. Cannot compile session.");
    return [];
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `You are a knowledge compiler. Read this coding session and extract the most useful learnings as structured knowledge.

For each distinct learning, output a JSON object on its own line:
{"slug":"concepts/X","title":"X","type":"concept","content":"..."}

Types: concept (technical insight), learning (how-to), project (what was built).
Slug should be lowercase with hyphens, prefixed by type (e.g. concepts/bun-sqlite-fts5).
Content should be 1-3 paragraphs of compiled truth — what was learned, why it matters, when to use it.
Extract 2-5 learnings. Only output valid JSON lines, nothing else.

SESSION:
${sessionText}`,
      },
    ],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";
  const results: Array<{ slug: string; title: string; type: string; content: string }> = [];

  for (const line of text.split("\n")) {
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
    name: "harvest",
    description: "Extract learnings from Claude Code session JSONL into brain pages",
  },
  args: {
    db: { type: "option", description: "Path to brain.db" },
    path: { type: "positional", description: "Path to JSONL file or directory", required: false },
  },
  async run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const db = openDb(dbPath);
    migrateDb(db);

    // Resolve session files
    let sessionPath = args.path as string | undefined;
    if (!sessionPath) {
      // Default: look for Claude Code sessions
      const home = process.env["HOME"] ?? "~";
      sessionPath = join(home, ".claude", "projects");
    }

    let files: string[] = [];
    try {
      const stat = statSync(sessionPath);
      if (stat.isFile()) {
        files = [sessionPath];
      } else {
        // Find all .jsonl files in directory tree
        function walkJsonl(dir: string): string[] {
          const found: string[] = [];
          for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            try {
              if (statSync(full).isDirectory()) {
                found.push(...walkJsonl(full));
              } else if (entry.endsWith(".jsonl")) {
                found.push(full);
              }
            } catch {}
          }
          return found;
        }
        files = walkJsonl(sessionPath);
      }
    } catch {
      console.error(`✗ Cannot read path: ${sessionPath}`);
      process.exit(1);
    }

    if (files.length === 0) {
      console.log("No .jsonl session files found.");
      return;
    }

    console.log(`Found ${files.length} session file(s). Compiling...`);

    const upsert = db.prepare(`
      INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, content_hash)
      VALUES (?, ?, ?, ?, '', json_object('type', ?, 'tags', json_array('harvested')), ?)
      ON CONFLICT(slug) DO UPDATE SET
        compiled_truth = compiled_truth || char(10) || char(10) || '---' || char(10) || char(10) || excluded.compiled_truth,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    `);

    let totalPages = 0;
    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);

      // Check if already processed
      const alreadyDone = db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) as n FROM ingest_log WHERE source_ref = ?"
        )
        .get(hash);
      if ((alreadyDone?.n ?? 0) > 0) {
        console.log(`  skip ${file} (already harvested)`);
        continue;
      }

      const entries = parseJSONL(raw);
      const sessionText = sessionToText(entries);
      if (!sessionText.trim()) {
        console.log(`  skip ${file} (empty)`);
        continue;
      }

      process.stdout.write(`  ${file.split("/").slice(-2).join("/")}...`);
      try {
        const learnings = await compileSession(sessionText);
        if (learnings.length === 0) {
          process.stdout.write(" (no learnings extracted)\n");
          continue;
        }

        for (const l of learnings) {
          upsert.run(l.slug, l.type ?? "concept", l.title, l.content, l.type ?? "concept", hash);
          totalPages++;
        }

        db.prepare(
          `INSERT INTO ingest_log (source_type, source_ref, pages_updated, summary) VALUES ('claude-session', ?, ?, ?)`
        ).run(
          hash,
          JSON.stringify(learnings.map((l) => l.slug)),
          `Harvested ${learnings.length} learnings from ${file.split("/").pop()}`
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
