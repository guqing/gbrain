# Changelog

All notable changes to gbrain are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.5.0] — 2025-06-11

### Added
- **Multimodal file system** — New schema tables (`files`, `file_chunks`, `file_references`, `import_checkpoints`, `import_runs`) for tracking imported files with metadata, FTS5 full-text search, and vector embeddings.
- **ChatGPT importer** (`gbrain import-chatgpt <dir>`) — Scans ChatGPT export archives, imports all conversations, and copies user-uploaded images into `~/.gbrain/files/`. Supports `--describe` flag to call a vision model (GPT-4o) and generate natural-language descriptions for each image.
- **Vision description pipeline** — `gbrain describe <file>` calls the configured vision model and stores the description. Descriptions are indexed in FTS5 so images are searchable by their visual content.
- **File management commands** — `gbrain files` lists imported files with size, type, and description status. `gbrain attach <path> <source>` manually attaches a file to a knowledge source. `gbrain detach <file>` removes a file record.
- **Import history** — `gbrain imports` lists past import runs with status, conversation counts, and timestamps.
- **Resume-safe imports** — `import_checkpoints` table tracks per-source progress so interrupted imports resume without re-processing completed conversations.
- **Vision config** — New `[vision]` section in `config.toml` (`base_url`, `api_key`, `model`) for configuring any OpenAI-compatible vision provider.
- **FTS5 trigger fix** — Fixed `bm25()` usage in `searchKeyword`; now uses a subquery join on `rowid` which is the correct SQLite FTS5 pattern.

### Changed
- Schema version bumped. `gbrain doctor` validates new tables.

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
