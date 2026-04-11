#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import { VERSION } from "./version.ts";

// Per-command help strings — machine-readable for agents.
// Run: gbrain <command> --help
export const COMMAND_HELP: Record<string, string> = {
  init:      "Usage: gbrain init [--db <path>]\n\nInitialise a new brain database (default: ~/.gbrain/brain.db).",
  config:    "Usage: gbrain config [list | get <key> | set <key> <value>]\n\nView and set gbrain configuration (embed provider, DB path, etc.).",
  get:       "Usage: gbrain get <slug>\n\nRead a page by slug.",
  put:       "Usage: gbrain put <slug> [< file.md]\n\nWrite or update a page from stdin.",
  delete:    "Usage: gbrain delete <slug>\n\nDelete a page (prompts for confirmation).",
  list:      "Usage: gbrain list [--type T] [--tag T] [--limit N]\n\nList pages with optional filters.",
  search:    "Usage: gbrain search <query> [--type T] [--limit N]\n\nFTS5 keyword search.",
  query:     "Usage: gbrain query <question> [--no-expand] [--limit N]\n\nHybrid search (FTS5 + vector RRF + Claude Haiku expansion). Requires embed API key (gbrain config set embed.api_key <key>).",
  link:      "Usage: gbrain link <from> <to> [--context <text>]\n\nCreate a typed link between two pages.",
  unlink:    "Usage: gbrain unlink <from> <to>\n\nRemove a link between two pages.",
  backlinks: "Usage: gbrain backlinks <slug>\n\nShow all pages that link to this page.",
  tag:       "Usage: gbrain tag <slug> <tag>\n\nAdd a tag to a page.",
  untag:     "Usage: gbrain untag <slug> <tag>\n\nRemove a tag from a page.",
  tags:      "Usage: gbrain tags [<slug>]\n\nList all tags, or tags for a specific page.",
  stats:     "Usage: gbrain stats\n\nBrain statistics (page count, type breakdown, etc.).",
  health:    "Usage: gbrain health\n\nBrain health dashboard (embedding coverage, stale pages, orphans, score/10).",
  lint:      "Usage: gbrain lint\n\nFlag stale pages (past valid_until) and orphaned pages with no links.",
  timeline:  "Usage: gbrain timeline <slug> [--limit N]\n\nView timeline entries for a page.",
  graph:     "Usage: gbrain graph <slug> [--depth N] [--json]\n\nTraverse the link graph (BFS). Default depth 3.",
  versions:  "Usage: gbrain versions <slug>\n\nList saved versions for a page.",
  embed:     "Usage: gbrain embed [<slug>] [--all]\n\nGenerate text embeddings via configured provider. Set embed.api_key with: gbrain config set embed.api_key <key>.",
  sync:      "Usage: gbrain sync\n\nEmbed all pages that are missing embeddings.",
  harvest:   "Usage: gbrain harvest [--source claude|copilot|codex|all] [--direct] [--dry-run]\n\nHarvest learnings from AI session logs into inbox (or directly with --direct).",
  capture:   "Usage: gbrain capture <text>\n\nCapture a quick note to the inbox for later compilation.",
  inbox:     "Usage: gbrain inbox\n\nShow queued inbox items (count, token estimate, oldest date).",
  compile:   "Usage: gbrain compile [--limit N] [--yes] [--interactive]\n\nProcess inbox items via LLM into structured knowledge pages.",
  digest:    "Usage: gbrain digest <conversations.json> [--all]\n\nCompile ChatGPT export conversations into brain pages via Claude Haiku. Requires ANTHROPIC_API_KEY.",
  export:    "Usage: gbrain export [--dir <path>]\n\nExport all pages to a markdown directory (round-trip safe).",
  import:    "Usage: gbrain import <path>\n\nImport a markdown file or directory (idempotent via content hash).",
  serve:     "Usage: gbrain serve\n\nStart MCP server on stdio. Connect via Claude Desktop or claude_mcp_config.json.",
  "setup-mcp": "Usage: gbrain setup-mcp\n\nGenerate claude_mcp_config.json for Claude Desktop integration.",
  doctor:      "Usage: gbrain doctor [--json]\n\nRun health checks on the brain database and configuration. Exit 1 on failures.",
  "check-update": "Usage: gbrain check-update [--json]\n\nCheck for a newer version of gbrain on npm. Only notifies on minor/major bumps.",
};

const main = defineCommand({
  meta: {
    name: "gbrain",
    version: VERSION,
    description: "Personal knowledge brain — CLI + MCP server",
  },
  subCommands: {
    // Setup
    init:        () => import("./commands/init.ts").then((m) => m.default),
    "setup-mcp": () => import("./commands/setup-mcp.ts").then((m) => m.default),
    config:      () => import("./commands/config.ts").then((m) => m.default),
    // Pages
    get:         () => import("./commands/get.ts").then((m) => m.default),
    put:         () => import("./commands/put.ts").then((m) => m.default),
    delete:      () => import("./commands/delete.ts").then((m) => m.default),
    list:        () => import("./commands/list.ts").then((m) => m.default),
    // Search
    search:      () => import("./commands/search.ts").then((m) => m.default),
    query:       () => import("./commands/query.ts").then((m) => m.default),
    // Links
    link:        () => import("./commands/link.ts").then((m) => m.default),
    unlink:      () => import("./commands/unlink.ts").then((m) => m.default),
    backlinks:   () => import("./commands/backlinks.ts").then((m) => m.default),
    // Tags
    tag:         () => import("./commands/tag.ts").then((m) => m.default),
    untag:       () => import("./commands/untag.ts").then((m) => m.default),
    tags:        () => import("./commands/tags.ts").then((m) => m.default),
    // Embeddings
    embed:       () => import("./commands/embed.ts").then((m) => m.default),
    sync:        () => import("./commands/sync.ts").then((m) => m.default),
    // AI ingest
    harvest:     () => import("./commands/harvest.ts").then((m) => m.default),
    capture:     () => import("./commands/capture.ts").then((m) => m.default),
    inbox:       () => import("./commands/inbox.ts").then((m) => m.default),
    compile:     () => import("./commands/compile/index.ts").then((m) => m.default),
    digest:      () => import("./commands/digest.ts").then((m) => m.default),
    // Import / Export
    export:      () => import("./commands/export.ts").then((m) => m.default),
    import:      () => import("./commands/import.ts").then((m) => m.default),
    // Admin
    stats:       () => import("./commands/stats.ts").then((m) => m.default),
    health:      () => import("./commands/health.ts").then((m) => m.default),
    lint:        () => import("./commands/lint.ts").then((m) => m.default),
    timeline:    () => import("./commands/timeline.ts").then((m) => m.default),
    graph:       () => import("./commands/graph.ts").then((m) => m.default),
    versions:    () => import("./commands/versions.ts").then((m) => m.default),
    // Diagnostics
    doctor:      () => import("./commands/doctor.ts").then((m) => m.default),
    "check-update": () => import("./commands/check-update.ts").then((m) => m.default),
    // MCP server
    serve:       () => import("./commands/serve.ts").then((m) => m.default),
    // Agent tool discovery
    "tools-json": defineCommand({
      meta: { description: "Print all MCP tool definitions as JSON (for agent tool discovery)" },
      run() {
        const tools = Object.entries(COMMAND_HELP).map(([name, help]) => ({
          name,
          description: help.split("\n\n")[1] ?? help,
          usage: help.split("\n")[0],
        }));
        console.log(JSON.stringify(tools, null, 2));
      },
    }),
  },
});

runMain(main);
