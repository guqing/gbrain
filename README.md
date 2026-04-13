<div align="center">

# exo

**Your exocortex. CLI + MCP server for personal knowledge management.**

[![npm version](https://img.shields.io/npm/v/@guqings/exo?color=blue)](https://www.npmjs.com/package/@guqings/exo)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](#license)
[![Bun](https://img.shields.io/badge/runtime-Bun%201.x-orange)](https://bun.sh)

[English](README.md) | [中文](README.zh.md)

</div>

---

AI coding sessions close and the experience disappears. ChatGPT threads pile up with nowhere to go. Notes accumulate but never get flagged as stale. **exo solves all three.**

Ingest ChatGPT exports, PDFs, images, and markdown files. Let LLMs compile raw sessions and conversations into structured knowledge pages. Search everything with hybrid FTS5 + vector search and LLM query expansion. Wire it into Claude Code or Cursor as an MCP server so your AI tools can read and write your brain directly.

## Table of Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Page format](#page-format)
- [Hybrid search](#hybrid-search)
- [AI ingestion](#ai-ingestion)
- [MCP server](#mcp-server)
- [Lint](#lint)
- [Development](#development)

---

## Install

```bash
bun install -g @guqings/exo
```

Requires [Bun](https://bun.sh) 1.x.

---

## Quick start

```bash
# Initialize your brain (default: ~/.exo/brain.db)
exo init

# Configure AI provider (OpenAI-compatible)
exo config set embed.api_key sk-...
exo config set embed.base_url https://api.openai.com/v1
exo config set compile.api_key sk-...

# Capture a quick note (no LLM, instant)
exo capture "Redis rate limiting: token bucket at 100 req/s per user"

# Or write a full page
echo '---
title: Redis Rate Limiting
type: concept
tags: [redis, backend]
---
Token bucket at 100 req/s per user. Use INCR + EXPIRE for sliding window.
' | exo put concepts/redis-rate-limiting

# Keyword search
exo search "redis rate limit"

# Hybrid search with AI query expansion (requires embed config)
exo query "how to prevent API abuse"

# Open the local Web UI
exo ui

# Read a page
exo get concepts/redis-rate-limiting

# Wire up to Claude Code / Cursor (one-time)
exo setup-mcp
```

---

## Commands

### Core

| Command | Description |
|---------|-------------|
| `exo init [path]` | Create `brain.db` (default: `~/.exo/brain.db`) |
| `exo get <slug>` | Read a page as markdown |
| `exo put <slug>` | Write or update a page (stdin or `--file`) |
| `exo delete <slug>` | Delete a page |
| `exo list` | List pages (`--type`, `--tag`, `--limit`) |
| `exo stats` | Brain statistics (page counts, DB size) |
| `exo health` | Brain health metrics |
| `exo config` | View and set configuration |

### Search

| Command | Description |
|---------|-------------|
| `exo search <query>` | FTS5 keyword search (`--type`, `--limit`) |
| `exo query <question>` | Hybrid search: FTS5 + vector RRF + LLM query expansion |
| `exo ui` | Localhost-only web UI for search and result browsing |

### AI Ingestion Pipeline

| Command | Description |
|---------|-------------|
| `exo capture [text]` | Instantly capture a note to the inbox (no LLM, <100ms) |
| `exo inbox` | View the inbox queue (items waiting to be compiled) |
| `exo compile` | Run LLM pipeline: inbox items → structured knowledge pages |
| `exo harvest` | Harvest learnings from Claude Code / Copilot / Codex session logs |
| `exo digest <file>` | Import conversations from a ChatGPT export JSON |
| `exo import-chatgpt <dir>` | Import a full ChatGPT export directory (conversations + images) |

### Files & Multimodal

| Command | Description |
|---------|-------------|
| `exo attach <slug> <file>` | Attach a file to a page (PDF, image, DOCX, audio, video) |
| `exo detach <slug> <file>` | Detach a file from a page |
| `exo files` | List all files attached to your brain |
| `exo describe [file-slug]` | Extract and embed content from files via AI (images, PDFs, DOCX, audio) |

### Embeddings & Sync

| Command | Description |
|---------|-------------|
| `exo embed` | Generate vector embeddings for pages (`--all`, `--rebuild`) |
| `exo sync <dir>` | Sync a directory of markdown files into the brain |
| `exo import <file\|dir>` | Import a markdown file or directory |
| `exo export` | Export pages to markdown files |

### Knowledge Graph

| Command | Description |
|---------|-------------|
| `exo link <from> <to>` | Create a cross-reference between two pages |
| `exo unlink <from> <to>` | Remove a cross-reference |
| `exo backlinks <slug>` | Show pages linking to a slug |
| `exo tag <slug> <tag>` | Add a tag |
| `exo untag <slug> <tag>` | Remove a tag |
| `exo tags [slug]` | List all tags, or tags for a specific page |
| `exo graph <slug>` | Traverse the knowledge graph from a slug |
| `exo timeline <slug>` | View or add timeline entries for a page |
| `exo versions <slug>` | Manage page versions (snapshot, list, revert) |

### Maintenance

| Command | Description |
|---------|-------------|
| `exo lint` | Check for stale, orphaned, and low-confidence pages |
| `exo doctor` | Run health checks on the database and configuration |
| `exo check-update` | Check for a newer version on npm |

### MCP / Agent

| Command | Description |
|---------|-------------|
| `exo serve` | Start the MCP stdio server |
| `exo setup-mcp` | Auto-configure MCP in Claude Code and Cursor |
| `exo call <tool>` | Invoke any MCP tool directly from the CLI |
| `exo tools-json` | Print all MCP tool definitions as JSON |

---

## Configuration

exo reads `~/.exo/config.toml`. Use `exo config` to view and `exo config set <key> <value>` to edit.

```toml
[db]
path = "~/.exo/brain.db"

[ui]
port = 7499

[embed]
base_url = "https://api.openai.com/v1"
api_key  = "sk-..."
model    = "text-embedding-3-large"

[compile]
base_url = "https://api.openai.com/v1"
api_key  = "sk-..."
model    = "gpt-4o"

[vision]
base_url = "https://api.openai.com/v1"
api_key  = "sk-..."
model    = "gpt-4o"
```

Any OpenAI-compatible provider works (Vercel AI Gateway, Azure OpenAI, Ollama, etc.).
`exo ui` binds to `127.0.0.1` only and opens `http://localhost:<port>` by default.

### DB path resolution

Priority order:
1. `--db <path>` flag (per-command override)
2. `EXO_DB` environment variable
3. `db.path` in `~/.exo/config.toml`
4. Default: `~/.exo/brain.db`

```bash
# Per-command
exo query "rate limiting" --db ~/work/brain.db

# Shell session
export EXO_DB=~/work/brain.db
```

---

## Page format

Pages use YAML frontmatter. A `---` separator (with blank lines around it) splits compiled knowledge from timeline entries.

```markdown
---
title: Redis Rate Limiting
type: concept
confidence: 9
valid_until: 2027-01-01
tags: [redis, backend, rate-limiting]
sources: [https://redis.io/docs/manual/patterns/]
---

# Redis Rate Limiting

Token bucket at 100 req/s per user. Use INCR + EXPIRE for sliding window.
Lua scripts ensure atomicity across INCR + EXPIRE.

---

## Timeline

- **2024-03-15**: Deployed to production. Token bucket chosen over leaky bucket.
- **2024-06-01**: Switched to sliding window after P99 spike analysis.
```

### Slug prefixes and page types

| Prefix | Type |
|--------|------|
| `concepts/` | concept |
| `learnings/` | learning |
| `people/` | person |
| `projects/` | project |
| `sources/` | source |

### Frontmatter fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Page title (required) |
| `type` | string | Page type (inferred from slug prefix if absent) |
| `confidence` | 0–10 | How sure you are this is still accurate |
| `valid_until` | YYYY-MM-DD | Flag as stale after this date |
| `tags` | string[] | Arbitrary labels |
| `sources` | string[] | URLs or references |

---

## Hybrid search

`exo query` combines three signals via Reciprocal Rank Fusion (RRF):

1. **FTS5 keyword search** — exact term matching, supports Chinese via LIKE fallback
2. **Vector search** — cosine similarity on `text-embedding-3-large` embeddings (requires `exo embed`)
3. **LLM query expansion** — rewrites your query into synonyms and related terms before searching

```bash
# Full hybrid (requires embeddings)
exo query "how to prevent API abuse"

# Keyword only (no API calls, instant)
exo search "redis rate limit"

# Disable query expansion (faster, exact terms)
exo query "redis INCR EXPIRE" --no-expand
```

Run `exo embed --all` after ingesting new content to keep vector search current.

---

## AI ingestion

### Capture → Compile pipeline

```bash
# 1. Capture anything instantly (no LLM, goes to inbox)
exo capture "Bun 1.2 ships native S3 client"
echo "Long note from stdin" | exo capture --title "My Note"

# 2. Check inbox
exo inbox

# 3. Compile inbox → structured knowledge pages (uses LLM)
exo compile
exo compile --yes    # skip confirmations
```

### Harvest from AI session logs

```bash
# Harvest Claude Code sessions (default)
exo harvest

# Harvest from all supported tools
exo harvest --source all

# Preview without writing
exo harvest --dry-run
```

Supported sources: Claude Code, GitHub Copilot CLI, Codex.

### Import ChatGPT conversations

```bash
# Export from ChatGPT settings → import
exo digest conversations.json

# Full export directory (conversations + images)
exo import-chatgpt ~/Downloads/chatgpt-export/
```

### Attach files

```bash
# Attach and describe an image (calls vision API)
exo attach concepts/my-page screenshot.png --describe

# Attach a PDF (auto-extracts and indexes text per page)
exo attach concepts/my-page paper.pdf

# Attach audio with transcription (calls Whisper API)
exo attach concepts/my-page meeting.mp3 --transcribe

# Process all unprocessed attached files
exo describe --all
```

---

## MCP server

exo exposes a [Model Context Protocol](https://modelcontextprotocol.io) server so Claude Code and Cursor can read and write your brain directly.

```bash
exo setup-mcp   # auto-writes ~/.claude/mcp.json and ~/.cursor/mcp.json
```

To configure manually in `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "exo": {
      "command": "exo",
      "args": ["serve"]
    }
  }
}
```

Available MCP tools: `brain_search`, `brain_query`, `brain_get`, `brain_put`, `brain_list`, `brain_link`, `brain_stats`, `brain_lint_summary`, `brain_capture`, `brain_timeline`.

---

## Lint

`exo lint` surfaces three classes of issues:

- **Stale** — `valid_until` is in the past
- **Low confidence** — `confidence <= 3`
- **Orphaned** — no links in or out, no tags

```bash
exo lint           # all issues
exo lint --json    # machine-readable output
```

---

## Development

```bash
git clone https://github.com/guqing/exo
cd exo
bun install
bun run dev                    # run from source: bun src/cli.ts
bun run ui:dev -- --db ~/path/to/brain.db
# API on 7499, Vite UI on 5173, /api proxied automatically
bun test ./src/tests/          # run test suite
bun run build                  # compile to single binary → bin/exo
```

---

## License

MIT
