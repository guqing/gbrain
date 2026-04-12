import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

interface ChatGptMessage {
  author?: { role?: string };
  content?: { content_type?: string; parts?: (string | null)[] };
  create_time?: number;
}

interface ChatGptNode {
  id?: string;
  message?: ChatGptMessage;
  children?: string[];
}

interface ChatGptConversation {
  id?: string;
  title?: string;
  create_time?: number;
  mapping?: Record<string, ChatGptNode>;
}

function slugify(text: string, maxLen = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, maxLen)
    .replace(/-+$/, "");
}

function extractConversationText(conversation: ChatGptConversation): Array<{ role: string; text: string }> {
  const mapping = conversation.mapping ?? {};
  const turns: Array<{ role: string; text: string; ts: number }> = [];

  for (const node of Object.values(mapping)) {
    const msg = node.message;
    if (!msg) continue;
    const role = msg.author?.role;
    if (role !== "user" && role !== "assistant") continue;
    if (msg.content?.content_type !== "text") continue;
    const parts = msg.content?.parts ?? [];
    const text = parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n").trim();
    if (!text) continue;
    turns.push({ role, text, ts: msg.create_time ?? 0 });
  }

  return turns.sort((a, b) => a.ts - b.ts).map(({ role, text }) => ({ role, text }));
}

export default defineCommand({
  meta: { name: "digest", description: "Import conversations from ChatGPT export JSON" },
  args: {
    file:     { type: "positional", description: "Path to ChatGPT export JSON (conversations.json)", required: true },
    db:       { type: "string",  description: "Path to brain.db" },
    limit:    { type: "string",  description: "Max conversations to import (default: all)" },
    "dry-run":{ type: "boolean", description: "Preview without writing", default: false },
    filter:   { type: "string",  description: "Only import conversations whose title matches this string" },
  },
  async run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));

    let raw: string;
    try {
      raw = await Bun.file(args.file).text();
    } catch (e) {
      console.error(`✗ Could not read file: ${args.file}\n  ${e}`);
      process.exit(1);
    }

    let conversations: ChatGptConversation[];
    try {
      const parsed = JSON.parse(raw);
      conversations = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      console.error(`✗ Invalid JSON in ${args.file}: ${e}`);
      process.exit(1);
    }

    if (args.filter) {
      conversations = conversations.filter(c => (c.title ?? "").toLowerCase().includes(args.filter!.toLowerCase()));
    }

    const maxConversations = args.limit ? parseInt(String(args.limit), 10) : conversations.length;
    const toProcess = conversations.slice(0, maxConversations);

    console.log(`Found ${conversations.length} conversations. Processing ${toProcess.length}...\n`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const conv of toProcess) {
      const title = (conv.title ?? "Untitled Conversation").slice(0, 100);
      const turns = extractConversationText(conv);

      if (turns.length < 2) { skipped++; continue; }

      const assistantContent = turns.filter(t => t.role === "assistant").map(t => t.text).join("\n\n---\n\n");
      if (!assistantContent.trim()) { skipped++; continue; }

      const titleSlug = slugify(title);
      const convId = (conv.id ?? "unknown").slice(0, 8);
      const slug = `chatgpt/${titleSlug}-${convId}`;

      const dateStr = conv.create_time
        ? new Date(conv.create_time * 1000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const frontmatterObj = {
        type: "conversation",
        tags: ["digest", "chatgpt"],
        source: `chatgpt-export:${conv.id ?? "unknown"}`,
        imported_at: new Date().toISOString().slice(0, 10),
        confidence: 7,
        original_date: dateStr,
      };

      const content = `---
title: "${title.replace(/"/g, '\\"')}"
type: conversation
tags: [digest, chatgpt]
source: chatgpt-export:${conv.id ?? "unknown"}
imported_at: ${frontmatterObj.imported_at}
confidence: 7
original_date: ${dateStr}
---

# ${title}

**Source:** ChatGPT Export  
**Date:** ${dateStr}  
**Turns:** ${turns.length}

## Key Content

${assistantContent}

## Full Conversation

${turns.slice(0, 20).map(t => `**${t.role === "user" ? "You" : "ChatGPT"}:** ${t.text.slice(0, 400)}${t.text.length > 400 ? "..." : ""}`).join("\n\n")}
`;

      const isExisting = !!engine.getPage(slug);

      if (args["dry-run"]) {
        console.log(`[DRY-RUN] Would ${isExisting ? "update" : "create"}: ${slug}`);
        console.log(`  Title: ${title}`);
        console.log(`  Turns: ${turns.length}`);
        continue;
      }

      if (isExisting) engine.createVersion(slug);

      engine.putPage(slug, {
        type: "conversation",
        title,
        compiled_truth: content,
        timeline: "",
        frontmatter: frontmatterObj,
      });

      engine.logIngest({
        source_type: "chatgpt-export",
        source_ref: `chatgpt:${conv.id ?? "unknown"}`,
        pages_updated: [slug],
        summary: `Imported ChatGPT conversation: ${title}`,
      });

      if (isExisting) { updated++; } else { created++; }
      console.log(`✓ ${isExisting ? "Updated" : "Created"}: ${slug}`);
    }

    if (!args["dry-run"]) {
      console.log(`\nDigest complete: ${created} created, ${updated} updated, ${skipped} skipped.`);
      if (created + updated > 0) {
        console.log(`Run 'exo embed --all' to generate embeddings for imported content.`);
      }
    }
  },
});
