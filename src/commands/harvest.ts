import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { generateInboxSlug, slugify, deconflictSlug } from "../core/utils.ts";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

// ── Claude Code JSONL types ────────────────────────────────────────────────

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

// ── Codex JSONL types ──────────────────────────────────────────────────────

interface CodexLine {
  timestamp: string;
  type: "session_meta" | "response_item" | "event_msg" | string;
  payload: {
    id?: string;
    cwd?: string;
    type?: string;
    role?: string;
    content?: Array<{ type: string; text?: string }>;
    task?: string;
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

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

function extractKeyLearnings(turns: Array<{ role: string; text: string }>): string {
  // Collect assistant responses that look like substantial knowledge content
  const substantial = turns
    .filter(t => t.role === "assistant" && t.text.length > 200)
    .map(t => t.text);
  return substantial.join("\n\n---\n\n");
}

// ── Copilot CLI harvest ────────────────────────────────────────────────────

interface CopilotCheckpoint { sessionId: string; file: string; path: string; title: string }

function collectCopilotCheckpoints(root: string, project?: string): CopilotCheckpoint[] {
  const result: CopilotCheckpoint[] = [];
  try {
    const sessionDirs = readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    for (const sessionId of sessionDirs) {
      const cpDir = join(root, sessionId, "checkpoints");
      if (!existsSync(cpDir)) continue;
      const files = readdirSync(cpDir).filter(f => f.endsWith(".md") && f !== "index.md");
      for (const file of files) {
        const titleMatch = file.replace(/^\d+-/, "").replace(/\.md$/, "").replace(/-/g, " ");
        if (project && !titleMatch.includes(project)) continue;
        result.push({ sessionId, file, path: join(cpDir, file), title: titleMatch });
      }
    }
  } catch { /* skip */ }
  return result;
}

function extractCopilotMeta(content: string): { overview: string; project: string } {
  const overviewMatch = content.match(/<overview>([\s\S]*?)<\/overview>/);
  const overview = overviewMatch?.[1]?.trim() ?? "";
  // Extract project name from overview — look for repo name pattern
  const repoMatch = overview.match(/`([^`]+\/[^`]+)`/) ?? overview.match(/at `([^`]+)`/);
  const project = repoMatch?.[1]?.split("/").slice(-2).join("/") ?? "unknown";
  return { overview, project };
}

function harvestCopilot(
  engine: SqliteEngine,
  root: string,
  opts: { project?: string; dryRun: boolean; limit: number; useInbox: boolean }
): { created: number; updated: number } {
  const all = collectCopilotCheckpoints(root, opts.project)
    .sort((a, b) => b.file.localeCompare(a.file))
    .slice(0, opts.limit);

  console.log(`Found ${all.length} Copilot checkpoints. Processing...\n`);

  let created = 0, updated = 0;
  for (const cp of all) {
    const content = readFileSync(cp.path, "utf-8");
    if (content.trim().length < 100) continue;

    const { overview, project } = extractCopilotMeta(content);
    const numMatch = cp.file.match(/^(\d+)/);
    const num = numMatch ? numMatch[1] : "";
    const nameSlug = cp.file.replace(/^\d+-/, "").replace(/\.md$/, "").slice(0, 44);
    const fileSlug = num ? `${num}-${nameSlug}` : nameSlug;
    const slug = `sessions/copilot/${cp.sessionId.slice(0, 8)}/${fileSlug}`;
    const title = cp.title.slice(0, 80);

    if (opts.dryRun) {
      console.log(`[DRY-RUN] Would ${opts.useInbox ? "inbox" : "create"}: ${slug}`);
      console.log(`  Project: ${project}  |  ${content.length} chars`);
      continue;
    }

    const today = new Date().toISOString().slice(0, 10);
    const mdContent = `---
title: "${title.replace(/"/g, '\\"')}"
type: session
tags: [harvest, copilot-cli, ${project.split("/").pop() ?? "unknown"}]
source: ${cp.path}
harvested_at: ${today}
confidence: 9
---

# ${title}

**Project:** ${project}  
**Session:** ${cp.sessionId.slice(0, 8)}  
**Checkpoint:** ${cp.file}

${overview ? `## Overview\n\n${overview}\n\n` : ""}## Full Checkpoint

${content}
`;

    if (opts.useInbox) {
      const inboxSlug = deconflictSlug(generateInboxSlug(mdContent), (s) => !!engine.getPage(s));
      engine.putPage(inboxSlug, { type: "inbox", title, compiled_truth: mdContent });
      engine.logIngest({ source_type: "copilot-checkpoint", source_ref: cp.path, pages_updated: [inboxSlug], summary: `Copilot checkpoint → inbox: ${title}` });
      created++;
      console.log(`✓ Inbox: ${inboxSlug}`);
    } else {
      const isExisting = !!engine.getPage(slug);
      if (isExisting) engine.createVersion(slug);
      engine.putPage(slug, {
        type: "session",
        title,
        compiled_truth: mdContent,
        timeline: "",
        frontmatter: { type: "session", tags: ["harvest", "copilot-cli"], source: cp.path, harvested_at: today, confidence: 9 },
      });
      engine.logIngest({ source_type: "copilot-checkpoint", source_ref: cp.path, pages_updated: [slug], summary: `Copilot checkpoint: ${title}` });
      if (isExisting) { updated++; } else { created++; }
      console.log(`✓ ${isExisting ? "Updated" : "Created"}: ${slug}`);
    }
  }
  return { created, updated };
}

// ── Codex harvest ──────────────────────────────────────────────────────────

interface CodexSession { date: string; file: string; path: string }

function collectCodexSessions(root: string): CodexSession[] {
  const result: CodexSession[] = [];
  function walk(dir: string, date: string) {
    try {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) walk(join(dir, ent.name), date ? date : ent.name);
        else if (ent.name.endsWith(".jsonl")) {
          result.push({ date, file: ent.name, path: join(dir, ent.name) });
        }
      }
    } catch { /* skip */ }
  }
  walk(root, "");
  return result;
}

function parseCodexSession(path: string): { cwd: string; task: string; turns: string[] } {
  const lines = readFileSync(path, "utf-8").split("\n").filter(l => l.trim());
  let cwd = "";
  let task = "";
  const turns: string[] = [];

  for (const line of lines) {
    let obj: CodexLine;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === "session_meta") {
      cwd = obj.payload.cwd ?? "";
    }
    if (obj.type === "event_msg" && obj.payload.type === "task_started") {
      task = (obj.payload as unknown as { task?: string }).task ?? "";
    }
    if (obj.type === "response_item" && obj.payload.role === "assistant") {
      const content = obj.payload.content ?? [];
      for (const block of content) {
        if (block.type === "output_text" && block.text && block.text.length > 150) {
          // Filter out internal reasoning noise (short action narrations)
          const text = block.text.trim();
          const isNarration = /^我(先|准备|再|要|已经|把|发现|看到|开始|顺手)/.test(text) && text.length < 400;
          if (!isNarration) turns.push(text);
        }
      }
    }
    // Also capture user task prompts from developer role
    if (obj.type === "response_item" && obj.payload.role === "developer") {
      const content = obj.payload.content ?? [];
      for (const block of content) {
        if (block.type === "input_text" && block.text && !task) {
          // Extract the user's actual task (skip system permissions preamble)
          const text = block.text.replace(/<permissions[\s\S]*?<\/permissions>/g, "").trim();
          if (text.length > 20) task = text.slice(0, 200);
        }
      }
    }
  }
  return { cwd, task, turns };
}

function harvestCodex(
  engine: SqliteEngine,
  root: string,
  opts: { dryRun: boolean; limit: number; useInbox: boolean }
): { created: number; updated: number } {
  const all = collectCodexSessions(root)
    .sort((a, b) => b.file.localeCompare(a.file))
    .slice(0, opts.limit);

  console.log(`Found ${all.length} Codex sessions. Processing...\n`);
  console.log("  Note: Codex sessions contain AI reasoning narration. Filtering heuristically.");
  console.log("  For better signal, set OPENAI_API_KEY and use exo digest after harvesting.\n");

  let created = 0, updated = 0;
  for (const session of all) {
    const { cwd, task, turns } = parseCodexSession(session.path);
    if (turns.length === 0) continue;

    const project = cwd.split("/").slice(-2).join("/") || "unknown";
    const sessionId = session.file.match(/([a-f0-9-]{36})/)?.[1]?.slice(0, 8) ?? session.file.slice(0, 8);
    const firstTurn = turns[0] ?? "session";
    const taskSlug = slugify((task || firstTurn).slice(0, 60));
    const slug = `sessions/codex/${project.replace(/\//g, "-")}/${taskSlug}-${sessionId}`;
    const title = (task || firstTurn || "Codex session").slice(0, 80).replace(/\n/g, " ");
    const today = new Date().toISOString().slice(0, 10);

    if (opts.dryRun) {
      console.log(`[DRY-RUN] Would ${opts.useInbox ? "inbox" : "create"}: ${slug}`);
      console.log(`  Task: ${title.slice(0, 60)}  |  ${turns.length} turns`);
      continue;
    }

    const learnings = turns.join("\n\n---\n\n");
    const mdContent = `---
title: "${title.replace(/"/g, '\\"')}"
type: session
tags: [harvest, codex, ${project.split("/").pop() ?? "unknown"}]
source: ${session.path}
harvested_at: ${today}
confidence: 6
---

# ${title}

**Project:** ${project}  
**Session:** ${sessionId}  
**Date:** ${session.date || today}

## Extracted Responses

${learnings}
`;

    if (opts.useInbox) {
      const inboxSlug = deconflictSlug(generateInboxSlug(mdContent), (s) => !!engine.getPage(s));
      engine.putPage(inboxSlug, { type: "inbox", title, compiled_truth: mdContent });
      engine.logIngest({ source_type: "codex-session", source_ref: session.path, pages_updated: [inboxSlug], summary: `Codex → inbox: ${title}` });
      created++;
      console.log(`✓ Inbox: ${inboxSlug}`);
    } else {
      const isExisting = !!engine.getPage(slug);
      if (isExisting) engine.createVersion(slug);
      engine.putPage(slug, {
        type: "session",
        title,
        compiled_truth: mdContent,
        timeline: "",
        frontmatter: { type: "session", tags: ["harvest", "codex"], source: session.path, harvested_at: today, confidence: 6 },
      });
      engine.logIngest({ source_type: "codex-session", source_ref: session.path, pages_updated: [slug], summary: `Codex: ${title}` });
      if (isExisting) { updated++; } else { created++; }
      console.log(`✓ ${isExisting ? "Updated" : "Created"}: ${slug}`);
    }
  }
  return { created, updated };
}

// ── Claude Code harvest (original) ────────────────────────────────────────

function harvestClaude(
  engine: SqliteEngine,
  claudeRoot: string,
  opts: { project?: string; dryRun: boolean; limit: number; useInbox: boolean }
): { created: number; updated: number } {
  if (!existsSync(claudeRoot)) {
    console.log(`  ⚠  Directory not found: ${claudeRoot}`);
    console.log(`  Tip: run Claude Code first, or use --dir to specify a custom path.`);
    return { created: 0, updated: 0 };
  }

  type SessionFile = { projectDir: string; file: string; path: string };
  const sessions: SessionFile[] = [];
  try {
    const projectDirs = readdirSync(claudeRoot, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    for (const projectDir of projectDirs) {
      if (opts.project && !projectDir.includes(opts.project)) continue;
      const projectPath = join(claudeRoot, projectDir);
      try {
        const files = readdirSync(projectPath).filter(f => f.endsWith(".jsonl") && !f.endsWith(".wakatime"));
        for (const file of files) sessions.push({ projectDir, file, path: join(projectPath, file) });
      } catch { /* skip */ }
    }
  } catch (e) {
    console.log(`  ⚠  Could not read ${claudeRoot}: ${e}`);
    return { created: 0, updated: 0 };
  }

  if (sessions.length === 0) { console.log("No Claude session logs found."); return { created: 0, updated: 0 }; }

  const toProcess = sessions.sort((a, b) => b.file.localeCompare(a.file)).slice(0, opts.limit);
  console.log(`Found ${sessions.length} sessions. Processing ${toProcess.length}...\n`);

  let created = 0, updated = 0;
  for (const session of toProcess) {
    const messages = parseJsonlFile(session.path);
    const turns = buildConversation(messages);
    if (turns.length < 2) continue;
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
    const today = new Date().toISOString().slice(0, 10);

    if (opts.dryRun) {
      console.log(`[DRY-RUN] Would ${opts.useInbox ? "inbox" : (engine.getPage(slug) ? "update" : "create")}: ${slug}`);
      console.log(`  Title: ${title}  |  Turns: ${turns.length}`);
      continue;
    }

    const content = `---
title: "${title.replace(/"/g, '\\"')}"
type: session
tags: [harvest, claude-code, ${projectName.split("/").pop() ?? "unknown"}]
source: ${session.path}
harvested_at: ${today}
confidence: 7
---

# ${title}

**Project:** ${projectName}  
**Date:** ${dateStr}  
**Session:** ${sessionId}

## Key Learnings

${learnings}

## Raw Conversation Summary

${turns.slice(0, 6).map(t => `**${t.role}:** ${t.text.slice(0, 300)}${t.text.length > 300 ? "..." : ""}`).join("\n\n")}
`;

    if (opts.useInbox) {
      const inboxSlug = deconflictSlug(generateInboxSlug(content), (s) => !!engine.getPage(s));
      engine.putPage(inboxSlug, { type: "inbox", title, compiled_truth: content });
      engine.logIngest({ source_type: "claude-session", source_ref: session.path, pages_updated: [inboxSlug], summary: `Claude → inbox: ${turns.length} turns from ${projectName}` });
      created++;
      console.log(`✓ Inbox: ${inboxSlug}`);
    } else {
      const isExisting = !!engine.getPage(slug);
      if (isExisting) engine.createVersion(slug);
      engine.putPage(slug, {
        type: "session",
        title,
        compiled_truth: content,
        timeline: "",
        frontmatter: { type: "session", tags: ["harvest", "claude-code"], source: session.path, harvested_at: dateStr, confidence: 7 },
      });
      engine.logIngest({ source_type: "claude-session", source_ref: session.path, pages_updated: [slug], summary: `Harvested ${turns.length} turns from ${projectName}` });
      if (isExisting) { updated++; } else { created++; }
      console.log(`✓ ${isExisting ? "Updated" : "Created"}: ${slug}`);
    }
  }
  return { created, updated };
}

// ── Command definition ─────────────────────────────────────────────────────

export default defineCommand({
  meta: { name: "harvest", description: "Harvest learnings from AI session logs (Claude Code, Copilot CLI, Codex)" },
  args: {
    db:       { type: "string",  description: "Path to brain.db" },
    source:   { type: "string",  description: "Session source: all (default), claude, copilot, codex" },
    dir:      { type: "string",  description: "Override default session directory" },
    project:  { type: "string",  description: "Filter to a specific project name" },
    "dry-run":{ type: "boolean", description: "Preview what would be created without writing", default: false },
    direct:   { type: "boolean", description: "Write directly to brain (skip inbox, old behavior)", default: false },
    limit:    { type: "string",  description: "Max sessions/checkpoints to process (default: 50)" },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const home = homedir();
    const source = (args.source ?? "all") as string;
    const dryRun = args["dry-run"] as boolean;
    const direct = args.direct as boolean;
    const useInbox = !direct;
    const limit = parseInt(String(args.limit ?? "50"), 10);

    if (useInbox && !dryRun) {
      console.log(`ℹ  Writing to inbox (use --direct to write directly to brain).\n   Run 'exo compile' to process captured items.\n`);
    }

    let totalCreated = 0, totalUpdated = 0;

    if (source === "copilot" || source === "all") {
      const root = args.dir ?? join(home, ".copilot", "session-state");
      console.log(`\n── Copilot CLI checkpoints ────────────────────────────`);
      console.log(`  Source: ${root}`);
      if (!existsSync(root)) {
        console.log(`  ⚠  Directory not found, skipping.`);
      } else {
        console.log(`  No LLM required — checkpoints are pre-structured summaries.\n`);
        const { created, updated } = harvestCopilot(engine, root, { project: args.project, dryRun, limit, useInbox });
        totalCreated += created; totalUpdated += updated;
      }
    }

    if (source === "codex" || source === "all") {
      const root = args.dir ?? join(home, ".codex", "sessions");
      console.log(`\n── Codex sessions ─────────────────────────────────────`);
      console.log(`  Source: ${root}`);
      if (!existsSync(root)) {
        console.log(`  ⚠  Directory not found, skipping.`);
      } else {
        const { created, updated } = harvestCodex(engine, root, { dryRun, limit, useInbox });
        totalCreated += created; totalUpdated += updated;
      }
    }

    if (source === "claude" || source === "all") {
      const root = args.dir ?? join(home, ".claude", "projects");
      console.log(`\n── Claude Code sessions ───────────────────────────────`);
      console.log(`  Source: ${root}\n`);
      const { created, updated } = harvestClaude(engine, root, { project: args.project, dryRun, limit, useInbox });
      totalCreated += created; totalUpdated += updated;
    }

    if (!dryRun) {
      if (useInbox) {
        console.log(`\n✓ Harvest complete: ${totalCreated} items added to inbox.`);
        console.log(`  Run 'exo inbox' to review, 'exo compile' to process.`);
      } else {
        console.log(`\n✓ Harvest complete: ${totalCreated} created, ${totalUpdated} updated.`);
        if (totalCreated + totalUpdated > 0) {
          console.log(`  Run 'exo embed --all' to generate embeddings for semantic search.`);
        }
      }
    }
  },
});
