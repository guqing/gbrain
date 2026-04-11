# Changelog

All notable changes to gbrain are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.4.0] — 2025-05-xx

### Bug Fixes
- **searchVector dedup** — Fixed flooding bug where pages with many chunks could monopolize all search result slots. Now returns the best-scoring chunk per page.
- **upsertChunks atomicity** — Replaced DELETE + INSERT (which wiped embeddings on interrupt) with INSERT OR REPLACE + chunk-count cleanup. A re-put of unchanged content no longer forces a full re-embed.
- Added `UNIQUE INDEX` on `content_chunks(page_id, chunk_index)` (migration + schema) to support safe UPSERT.

### New Commands
- `gbrain doctor` — 8 health checks (connection, FTS index, embedding coverage, orphan chunks, schema version, embed config, compile config, inbox backlog). `--json` flag for scripting. Exit 1 on failures.
- `gbrain check-update` — Checks npm registry for newer versions. Only shows notification for minor/major bumps. Fail-silent with 10s timeout.

### New MCP Tools
- `brain_hybrid_search` — Reciprocal Rank Fusion (RRF) of FTS5 keyword + vector results (k=60). Falls back to keyword-only when embedding is unavailable.
- `brain_export` — Export a page as standalone markdown with full YAML frontmatter (round-trip safe).

### Improvements
- **brain_get** — New `fuzzy: true` param. Falls back to FTS5 slug search when exact slug not found. Returns `<!-- resolved from ... -->` comment on fuzzy match.
- **brain_put** — New `dry_run: true` param. Returns `{action, slug, title}` preview without writing.
- **brain_delete** — New `dry_run: true` param. Returns count of links, backlinks, and tags that would be removed.
- **compile_inbox** — New `dry_run: true` param. Returns inbox count without processing.
- **BrainError** — Typed error class (`src/core/errors.ts`) with `BrainErrorCode` for structured error handling across tools.
- `skills/manifest.json` — Machine-readable index of all available skills.

---

## [0.3.0] — 2025-05-09

### New Features
- **Inbox + compile pipeline** — `gbrain harvest` now routes to inbox by default (`--direct` bypasses). `gbrain compile` processes inbox items through the LLM compile pipeline.
- `compile_inbox` MCP tool — Agents can trigger inbox compilation directly.
- `brain_keyword_search` MCP tool — Pure FTS5 keyword search (no embedding required).

### Improvements
- harvest: `--direct` flag for bypassing inbox (legacy behavior)
- compile: `--limit` flag, `--yes` for non-interactive mode
- Inbox queue tracked in lint report

---

## [0.2.0] — 2025-04-xx

### New Features
- **AI compilation layer** — `gbrain harvest` (Claude Code session logs), `gbrain digest` (ChatGPT exports)
- `gbrain embed` — Vector embeddings via OpenAI `text-embedding-3-small`
- `gbrain query` — Semantic search (FTS5 + cosine similarity merged)
- `gbrain compile` — LLM compiles raw sources into structured knowledge pages
- `gbrain sync` — Git-backed incremental sync with ancestry validation
- Embedding abstraction interface (swappable providers)
- Skills: harvest, digest, briefing, query, maintain, ingest

---

## [0.1.0] — 2025-04-xx

### Initial Release
- `gbrain init` — Create brain.db with full schema
- `gbrain get/put/list/search` — Core CRUD + FTS5 search
- `gbrain link/unlink/tag/untag/tags` — Cross-references and tags
- `gbrain stats/health/lint` — Brain introspection
- `gbrain export/import` — Lossless markdown round-trip
- `gbrain serve` — MCP stdio server
- `gbrain setup-mcp` — Auto-configure Claude Desktop
- `gbrain versions/timeline/graph/backlinks` — Knowledge graph traversal
- SQLite + FTS5, no native dependencies
- Distribution via npm (`bun install -g gbrain`)
