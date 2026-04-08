import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";

// ── Claude JSONL message types ─────────────────────────────────────────────

interface ClaudeMessage {
  type: "user" | "assistant" | "system" | string;
  isMeta?: boolean;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
}

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | string;
  text?: string;
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is ContentBlock & { type: "text"; text: string } => b.type === "text" && !!b.text)
    .map(b => b.text)
    .join("\n");
}

function parseJsonlFile(path: string): ClaudeMessage[] {
  const lines = readFileSync(path, "utf-8").split("\n").filter(l => l.trim());
  const messages: ClaudeMessage[] = [];
  for (const line of lines) {
    try { messages.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return messages;
}

function buildConversation(messages: ClaudeMessage[]): Array<{ role: string; text: string; ts: string }> {
  const turns: Array<{ role: string; text: string; ts: string }> = [];
  for (const msg of messages) {
    if (msg.isMeta) continue;
    if (msg.type !== "user" && msg.type !== "assistant") continue;
    if (!msg.message?.content) continue;
    const text = extractText(msg.message.content).trim();
    if (!text) continue;
    turns.push({ role: msg.type, text, ts: msg.timestamp ?? "" });
  }
  return turns;
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

function extractKeyLearnings(turns: Array<{ role: string; text: string }>): string {
  // Collect assistant responses that look like substantial knowledge content
  const substantial = turns
    .filter(t => t.role === "assistant" && t.text.length > 200)
    .map(t => t.text);
  return substantial.join("\n\n---\n\n");
}

export default defineCommand({
  meta: { name: "harvest", description: "Harvest learnings from Claude Code session logs" },
  args: {
    db:      { type: "string",  description: "Path to brain.db" },
    dir:     { type: "string",  description: "Directory of JSONL files (default: ~/.claude/projects/)" },
    project: { type: "string",  description: "Filter to a specific project name" },
    "dry-run": { type: "boolean", description: "Preview what would be created without writing", default: false },
    limit:   { type: "string",  description: "Max sessions to process (default: 10)" },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const claudeRoot = args.dir ?? join(process.env["HOME"] ?? "~", ".claude", "projects");

    if (!existsSync(claudeRoot)) {
      console.error(`✗ Claude projects directory not found: ${claudeRoot}`);
      console.error("  Run Claude Code first to generate session logs.");
      process.exit(1);
    }

    // Collect all JSONL files
    type SessionFile = { projectDir: string; file: string; path: string };
    const sessions: SessionFile[] = [];
    try {
      const projectDirs = readdirSync(claudeRoot, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const projectDir of projectDirs) {
        if (args.project && !projectDir.includes(args.project)) continue;
        const projectPath = join(claudeRoot, projectDir);
        try {
          const files = readdirSync(projectPath)
            .filter(f => f.endsWith(".jsonl") && !f.endsWith(".wakatime"));
          for (const file of files) {
            sessions.push({ projectDir, file, path: join(projectPath, file) });
          }
        } catch { /* skip unreadable dirs */ }
      }
    } catch (e) {
      console.error(`✗ Could not read ${claudeRoot}: ${e}`);
      process.exit(1);
    }

    if (sessions.length === 0) {
      console.log("No Claude session logs found.");
      return;
    }

    const maxSessions = parseInt(String(args.limit ?? "10"), 10);
    // Sort by filename (UUID = timestamp-ordered in practice) and take latest
    const toProcess = sessions
      .sort((a, b) => b.file.localeCompare(a.file))
      .slice(0, maxSessions);

    console.log(`Found ${sessions.length} sessions. Processing ${toProcess.length}...\n`);

    let created = 0;
    let updated = 0;
    const ingestRefs: string[] = [];

    for (const session of toProcess) {
      const messages = parseJsonlFile(session.path);
      const turns = buildConversation(messages);
      if (turns.length < 2) continue;

      // First user turn = topic/intent
      const firstUserTurn = turns.find(t => t.role === "user");
      if (!firstUserTurn) continue;

      const projectName = session.projectDir.replace(/^-/, "").replace(/-/g, "/").replace(/^Users\/[^/]+\//, "");
      const topicSlug = slugify(firstUserTurn.text.slice(0, 60));
      const sessionId = basename(session.file, ".jsonl").slice(0, 8);
      const slug = `sessions/${projectName}/${topicSlug}-${sessionId}`.replace(/\/+/g, "/");

      const learnings = extractKeyLearnings(turns);
      if (!learnings.trim()) continue;

      const title = firstUserTurn.text.slice(0, 80).replace(/\n/g, " ");
      const ts = turns[0]?.ts ?? new Date().toISOString();
      const dateStr = ts.slice(0, 10);

      const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
type: session
tags: [harvest, claude-code, ${projectName.split("/").pop() ?? "unknown"}]
source: ${session.path}
harvested_at: ${new Date().toISOString().slice(0, 10)}
confidence: 7
---`;

      const content = `${frontmatter}

# ${title}

**Project:** ${projectName}  
**Date:** ${dateStr}  
**Session:** ${sessionId}

## Key Learnings

${learnings}

## Raw Conversation Summary

${turns.slice(0, 6).map(t => `**${t.role}:** ${t.text.slice(0, 300)}${t.text.length > 300 ? "..." : ""}`).join("\n\n")}
`;

      const isExisting = !!engine.getPage(slug);

      if (args["dry-run"]) {
        console.log(`[DRY-RUN] Would ${isExisting ? "update" : "create"}: ${slug}`);
        console.log(`  Title: ${title}`);
        console.log(`  Turns: ${turns.length}, Learnings: ${learnings.length} chars`);
        continue;
      }

      if (isExisting) {
        engine.createVersion(slug);
      }

      engine.putPage(slug, {
        type: "session",
        title,
        compiled_truth: content,
        timeline: "",
        frontmatter: {
          type: "session",
          tags: ["harvest", "claude-code"],
          source: session.path,
          harvested_at: dateStr,
          confidence: 7,
        },
      });

      engine.logIngest({
        source_type: "claude-session",
        source_ref: session.path,
        pages_updated: [slug],
        summary: `Harvested ${turns.length} turns from ${projectName}`,
      });

      ingestRefs.push(slug);
      if (isExisting) { updated++; } else { created++; }
      console.log(`✓ ${isExisting ? "Updated" : "Created"}: ${slug}`);
    }

    if (!args["dry-run"]) {
      console.log(`\nHarvest complete: ${created} created, ${updated} updated.`);
      if (created + updated > 0) {
        console.log(`Run 'gbrain embed --all' to generate embeddings for harvested content.`);
      }
    }
  },
});
