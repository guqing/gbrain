# Design System — Personal Knowledge Brain (`gbrain`)

> Product design document. Every AI session building this tool should read this file first.
> This is the source of truth for architecture, schema, CLI conventions, and skill design.

---

## Product Context

- **What this is:** A personal knowledge brain — CLI tool + MCP server that compiles and maintains a persistent, queryable knowledge base from AI coding sessions, ChatGPT conversations, and other learning sources.
- **Who it's for:** Individual developers who use AI coding agents (Claude Code, Copilot, Codex) and want to accumulate knowledge across sessions rather than starting from zero every time.
- **Space/industry:** Developer tooling / personal knowledge management
- **Project type:** CLI tool + MCP server (Web UI deferred)

### Pain Points This Solves

1. **AI coding session knowledge loss** — Experience gained solving hard problems with Claude Code/Copilot disappears when the session closes. No accumulation.
2. **Learning material entropy** — ChatGPT conversations and learning sessions produce noise (chat transcripts), not signal (structured knowledge). Raw markdown from exports is unusable.
3. **Knowledge staleness** — Technical knowledge (framework APIs, best practices) changes. Documents accumulate but never get flagged as outdated. Stale knowledge is worse than no knowledge.

---

## Architecture (Three Layers)

Synthesis of GBrain (Garry Tan) + LLM Wiki (Karpathy):

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Query Layer                                     │
│  gbrain query / gbrain search / MCP tools                 │
│  Claude Code reads your brain during coding sessions      │
└─────────────────────────────────────────────────────────┘
         ↑
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Compilation Layer (Skills)                      │
│  harvest → session logs → learnings                       │
│  digest  → chat exports → structured knowledge            │
│  lint    → staleness scan + orphan detection              │
└─────────────────────────────────────────────────────────┘
         ↑
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Storage (brain.db)                              │
│  SQLite + FTS5 + sqlite-vec                               │
│  Compiled truth + timeline architecture                   │
└─────────────────────────────────────────────────────────┘
```

### Key Insight

Karpathy's pattern: the LLM **builds and maintains** the wiki. You curate sources and ask questions. This is not RAG (re-deriving from raw docs every time). Knowledge is **compiled once, kept current**, and compounds.

GBrain's insight: SQLite is the right backend. One file (`brain.db`). No server, no Docker. Portable. Queryable.

---

## Data Schema

### Philosophy: Compiled Truth + Timeline

Every knowledge page has two zones:

- **Compiled truth** (above the line): Always current. Rewritten when new info arrives. The intelligence assessment — what we know NOW.
- **Timeline** (below the line): Append-only. Never rewritten. The evidence base — where the knowledge came from.

The separator is `---` in markdown, implicit in the database.

### SQLite Schema (`brain.db`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Core pages table
CREATE TABLE pages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT    NOT NULL UNIQUE,   -- e.g. "concepts/react-suspense", "learnings/2026-04"
  type           TEXT    NOT NULL,          -- concept, learning, person, project, source
  title          TEXT    NOT NULL,
  compiled_truth TEXT    NOT NULL DEFAULT '', -- markdown, above the line (current best understanding)
  timeline       TEXT    NOT NULL DEFAULT '', -- markdown, below the line (evidence, append-only)
  frontmatter    TEXT    NOT NULL DEFAULT '{}', -- JSON: tags, valid_until, confidence, sources
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_pages_type ON pages(type);
CREATE INDEX idx_pages_slug ON pages(slug);

-- Full-text search (FTS5 with Porter stemming)
CREATE VIRTUAL TABLE page_fts USING fts5(
  title, compiled_truth, timeline,
  content='pages', content_rowid='id',
  tokenize='porter unicode61'
);

-- Auto-sync triggers
CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline);
END;
CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline);
END;
CREATE TRIGGER pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline);
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline);
END;

-- Vector embeddings (sqlite-vec)
CREATE TABLE page_embeddings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text  TEXT    NOT NULL,
  embedding   BLOB    NOT NULL,  -- Float32Array raw bytes
  model       TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Cross-references between pages
CREATE TABLE links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_page_id   INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  context      TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(from_page_id, to_page_id)
);

-- Tags
CREATE TABLE tags (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  UNIQUE(page_id, tag)
);
CREATE INDEX idx_tags_tag ON tags(tag);

-- Staleness tracking
CREATE TABLE staleness_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  checked_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  outcome     TEXT    NOT NULL,  -- "current", "outdated", "uncertain"
  notes       TEXT    NOT NULL DEFAULT ''
);

-- Ingest log (append-only operation history)
CREATE TABLE ingest_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT NOT NULL,    -- "session", "chatgpt", "article", "manual"
  source_ref    TEXT NOT NULL,    -- session ID, file path, URL
  pages_updated TEXT NOT NULL DEFAULT '[]',  -- JSON array of slugs
  summary       TEXT NOT NULL DEFAULT '',
  timestamp     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Config
CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO config (key, value) VALUES
  ('version', '1'),
  ('embedding_model', 'text-embedding-3-small'),
  ('chunk_strategy', 'section');
```

### Page Frontmatter Convention (JSON)

```json
{
  "tags": ["react", "performance", "hooks"],
  "type": "concept",
  "confidence": 8,
  "valid_until": "2026-12-31",
  "last_verified": "2026-04-08",
  "sources": ["chatgpt-export-2026-03-15", "session-2026-04-01"],
  "version_applies_to": "React 19"
}
```

- `valid_until`: ISO date. After this date, lint flags the page as potentially stale.
- `confidence`: 1-10. Your belief that this knowledge is still accurate.
- `version_applies_to`: For framework/library knowledge, pin the version it was true for.

---

## CLI Design

### Stack

- **Runtime**: Bun (fast startup, built-in SQLite, TypeScript-native)
- **Database**: SQLite via `bun:sqlite` + `sqlite-vec` extension for vectors
- **Embeddings**: OpenAI `text-embedding-3-small` (via `OPENAI_API_KEY` env var)
- **MCP**: `@modelcontextprotocol/sdk`

### Project Structure

```
gbrain/
  bin/gbrain              # compiled Bun binary
  src/
    cli.ts                # argument parser + dispatcher
    commands/
      init.ts
      get.ts
      put.ts
      search.ts
      query.ts
      harvest.ts          # AI coding session → learnings
      digest.ts           # ChatGPT export → knowledge
      lint.ts             # staleness + health check
      link.ts
      tags.ts
      list.ts
      stats.ts
      embed.ts
      export.ts
      import.ts
      serve.ts            # MCP server
    core/
      db.ts               # database connection + helpers
      fts.ts              # FTS5 search
      embeddings.ts       # vector embedding + cosine similarity
      markdown.ts         # frontmatter parsing, content splitting
      links.ts            # link extraction + resolution
    mcp/
      server.ts           # MCP stdio server
    skills/
      harvest/SKILL.md    # session harvest workflow
      digest/SKILL.md     # chatgpt digest workflow
      lint/SKILL.md       # staleness lint workflow
```

### Commands

```
gbrain init [path]                          # create brain.db in current dir
gbrain get <slug>                           # read a page
gbrain put <slug> [< file.md]              # write/update a page
gbrain search <query>                       # FTS5 keyword search
gbrain query <question>                     # semantic search (FTS5 + vector)
gbrain harvest <session-log>                # ingest AI coding session log
gbrain digest <chatgpt-export.json>         # ingest ChatGPT conversation export
gbrain lint                                 # check staleness, orphans, gaps
gbrain link <from> <to> [--context "..."]  # create cross-reference
gbrain tags <slug>                          # list tags
gbrain tag <slug> <tag>                     # add tag
gbrain list [--type concept] [--tag react] # list pages
gbrain stats                                # brain statistics
gbrain embed [<slug>|--all]                # generate vector embeddings
gbrain export [--dir ./export/]            # export to markdown files
gbrain import <dir>                         # import from markdown directory
gbrain serve                                # start MCP server (stdio)
gbrain version
```

### Output Format Conventions

- **Default**: plain text / markdown (human-readable, Claude-friendly)
- `--json`: JSON output for programmatic use
- `--quiet`: suppress progress messages, only output result
- Errors to stderr, results to stdout
- Progress indicators: `...` suffix (e.g., `Ingesting 47 pages...`)
- Success: ✓ prefix (e.g., `✓ brain.db created at ./brain.db`)
- Warnings: `⚠` prefix (stale pages, orphans)

### Database Location

1. `GBRAIN_DB` environment variable
2. `--db /path/to/brain.db` flag
3. `./brain.db` in current directory (default)

---

## Skill Design

### Skill 1: `harvest` — Session → Learnings

**Trigger**: After any AI coding session worth capturing.

**Input**: Claude Code session transcript / log file (or stdin pipe from `claude --print-transcript`)

**Workflow**:
1. Read the session transcript
2. Identify: problems solved, approaches tried, errors encountered and fixed, tools/commands discovered, patterns that worked, anti-patterns to avoid
3. For each learning, check `gbrain get learnings/<slug>` — does a page exist?
   - If yes: update `compiled_truth` with new info, append session reference to `timeline`
   - If no: create new page with appropriate frontmatter
4. Set `confidence` based on: did the solution actually work? (high) vs. theoretical? (lower)
5. Set `valid_until` based on: is this framework-specific? (18 months) vs. fundamental? (omit)
6. Create cross-references to relevant concept pages
7. Log to `ingest_log`

**Output**: Summary of pages created/updated, links made.

**Anti-pattern to avoid**: Don't save the raw session transcript. Compile the insights. The transcript is noise; the learning is signal.

---

### Skill 2: `digest` — ChatGPT Export → Knowledge

**Trigger**: When processing a ChatGPT conversation export.

**Input**: ChatGPT export JSON (`conversations.json`) or a single conversation JSON.

**Workflow**:
1. Parse the conversation JSON
2. Identify the conversation's intent: what was the user trying to learn?
3. Extract key concepts discussed — what did the user learn that was new?
4. For each concept, check if a page exists in the brain
   - If yes: update compiled_truth with any new information, append source to timeline
   - If no: create a new concept page with structured content
5. Flag any knowledge marked as time-sensitive (framework versions, etc.) with `valid_until`
6. Do NOT save the raw conversation. The output is structured knowledge pages.
7. Log to `ingest_log`

**Output**: Pages created/updated. Summary of extracted concepts.

**Key behavior**: One ChatGPT conversation might create or update 5-15 pages. That's correct — concepts are cross-cutting.

---

### Skill 3: `lint` — Staleness + Health Check

**Trigger**: Run periodically (weekly or before a new project starts).

**Checks**:
1. **Expired pages**: find all pages where frontmatter `valid_until` < today → flag as `⚠ STALE`
2. **Low confidence**: pages with `confidence` < 5 → flag for review
3. **Orphan pages**: pages with no incoming links → flag for possible deletion or linking
4. **Missing pages**: find concept names mentioned in many pages but lacking their own page → suggest creating
5. **Version gaps**: pages with `version_applies_to` set → check if the named version is still current (optionally via web search)

**Output format**:
```
STALE (12):
  ⚠ concepts/react-concurrent-mode  (expired 2025-12-01, confidence: 6)
  ⚠ concepts/webpack-config-2024    (expired 2025-09-15, confidence: 7)
  ...

ORPHANS (3):
  concepts/vite-proxy-config  (0 incoming links)
  ...

SUGGESTED (2):
  concepts/bun-test-api  (mentioned in 8 pages, no dedicated page)
  ...
```

---

## MCP Server Tools

Exposed to Claude Code, Copilot, and any MCP-compatible client:

| Tool | Description |
|------|-------------|
| `brain_search` | FTS5 keyword search |
| `brain_query` | Semantic search (FTS5 + vector merged) |
| `brain_get` | Read a page by slug |
| `brain_put` | Write/update a page |
| `brain_ingest` | Ingest a source document |
| `brain_link` | Create a cross-reference |
| `brain_list` | List pages with filters |
| `brain_stats` | Brain statistics |
| `brain_lint_summary` | Return current staleness summary |

### MCP Config (`~/.claude/mcp.json`)

```json
{
  "mcpServers": {
    "gbrain": {
      "command": "gbrain",
      "args": ["serve", "--db", "~/brain.db"]
    }
  }
}
```

Claude Code will automatically query your brain during coding sessions once MCP is configured.

---

## Page Format Convention

### Markdown Page Template

```markdown
---
title: React Suspense for Data Fetching
type: concept
tags: [react, async, data-fetching]
confidence: 8
valid_until: 2027-01-01
last_verified: 2026-04-08
version_applies_to: React 19
sources: [session-2026-03-28, chatgpt-2026-04-01]
---

# React Suspense for Data Fetching

> One-line thesis: what this IS and what it does for you.

## Compiled Truth

[Current best understanding. Rewritten when new info arrives.]

Key points:
- ...
- ...

Common pitfalls:
- ...

## When to use / when not to

...

---

## Timeline

- **2026-04-01** (chatgpt-digest): First encountered while debugging async waterfall...
- **2026-03-28** (session-harvest): Used in production, found that X causes Y...
```

### Slug Conventions

```
concepts/<topic-name>       # technical concepts, patterns, APIs
learnings/<YYYY-MM>         # monthly learning summaries from sessions
people/<name>               # people worth tracking
projects/<name>             # project-specific knowledge
sources/<id>                # reference to ingested sources
```

---

## AGENTS.md Template (place in brain directory)

This file tells Claude Code how to maintain your brain:

```markdown
# Brain Maintenance Schema

## What this is
A personal knowledge brain. SQLite-backed, compiled_truth + timeline architecture.
The LLM writes and maintains wiki pages. The human curates sources and asks questions.

## Core operations

### Harvest (after a coding session)
- Read the session, extract learnings
- Check gbrain get <slug> before creating new pages
- Update compiled_truth for existing pages, append to timeline
- Set valid_until for framework-specific knowledge (18 months default)
- Never save raw transcripts — only compiled insights

### Digest (ChatGPT export)
- Parse conversations.json
- Extract concepts, not conversations
- Create/update concept pages with structured content
- One conversation = multiple pages (that's correct)

### Lint (health check)
- Run: gbrain lint
- Review stale pages and update or delete
- Verify low-confidence pages
- Link orphan pages or delete if irrelevant

## Page types
- concept: technical knowledge (APIs, patterns, tools)
- learning: session-derived insights
- person: people worth tracking
- project: project-specific knowledge

## Never do
- Save raw chat transcripts as pages
- Create pages without at least one timeline entry
- Set confidence > 8 without verifying in production
```

---

## Build Plan

### Phase 1 (MVP — usable in one day)
- [ ] `gbrain init` — create brain.db with full schema
- [ ] `gbrain put` / `gbrain get` — read/write pages
- [ ] `gbrain search` — FTS5 keyword search
- [ ] `gbrain lint` — basic staleness check (no web verification)
- [ ] `gbrain serve` — MCP server with core tools

### Phase 2 (Core workflows)
- [ ] `gbrain harvest` — session log → learnings (requires OpenAI API)
- [ ] `gbrain digest` — ChatGPT export → knowledge pages (requires OpenAI API)
- [ ] `gbrain embed` / `gbrain query` — vector semantic search

### Phase 3 (Growth)
- [ ] `gbrain import` — migrate from markdown directory
- [ ] `gbrain export` — lossless export back to markdown
- [ ] Web UI (knowledge graph visualization, staleness dashboard)

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-08 | SQLite over Postgres | Single-user, portable, no server. One file = one brain. |
| 2026-04-08 | Bun over Node.js | Built-in SQLite, TypeScript-native, fast CLI startup |
| 2026-04-08 | No Web UI in Phase 1-2 | Avoids complexity. CLI + MCP covers all access patterns. Defer. |
| 2026-04-08 | LLM compiles knowledge, human curates | Karpathy pattern. Raw transcripts are noise; compiled insights are signal. |
| 2026-04-08 | compiled_truth + timeline separation | GBrain pattern. Current knowledge vs. historical evidence are different things. |
| 2026-04-08 | valid_until in frontmatter | Framework knowledge goes stale. Flag it explicitly, don't discover it by accident. |
| 2026-04-08 | MCP from day one | Every AI coding tool supports MCP. Zero-cost integration for future tools. |
