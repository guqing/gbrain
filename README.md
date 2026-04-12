# exo

Your personal knowledge brain. CLI + MCP server.

AI coding sessions close and the experience disappears. ChatGPT threads pile up with nowhere to go. Documentation accumulates but never gets flagged as stale. exo solves all three.

Store knowledge once. Search it fast. Let LLMs compile raw sessions and conversations into structured pages. Wire it into Claude Code or Cursor as an MCP server and your AI tools can read and write your brain directly.

---

## Install

```bash
bun install -g exo
```

Requires [Bun](https://bun.sh) 1.x.

---

## Quick start

```bash
# Create a brain in your current directory
exo init

# Add a concept page (reads from stdin)
echo '---
title: FTS5 Prefix Queries
type: concept
confidence: 8
tags: [sqlite, search]
---

# FTS5 Prefix Queries

FTS5 supports prefix queries: embed* matches "embed", "embeddings", "embedded".
' | exo put concepts/fts5-prefix-queries

# Search
exo search "fts5 prefix"

# Read a page
exo get concepts/fts5-prefix-queries

# Cross-reference two pages
exo link concepts/fts5-prefix-queries concepts/sqlite

# Wire up to Claude Code / Cursor (one-time)
exo setup-mcp
```

---

## Commands

| Command | Description |
|---------|-------------|
| `exo init` | Create `brain.db` in the current directory |
| `exo get <slug>` | Read a page as markdown |
| `exo put <slug>` | Write/update a page from stdin or `--file` |
| `exo search <query>` | FTS5 keyword search (`--type`, `--limit`) |
| `exo list` | List pages (`--type`, `--tag`, `--limit`) |
| `exo link <from> <to>` | Create a cross-reference |
| `exo unlink <from> <to>` | Remove a cross-reference |
| `exo backlinks <slug>` | Show pages linking to a slug |
| `exo tag <slug> <tag>` | Add a tag |
| `exo untag <slug> <tag>` | Remove a tag |
| `exo tags <slug>` | List tags for a page |
| `exo stats` | Brain statistics (counts, DB size) |
| `exo lint` | Check for stale, orphaned, and low-confidence pages |
| `exo serve` | Start the MCP stdio server |
| `exo setup-mcp` | Auto-configure MCP in Claude Code and Cursor |
| `exo version` | Print version |

---

## Page format

Pages use YAML frontmatter. A `---` separator (with blank lines around it) splits compiled truth from timeline.

```markdown
---
title: Bun SQLite
type: concept
confidence: 9
valid_until: 2027-01-01
tags: [bun, sqlite]
sources: [https://bun.sh/docs/api/sqlite]
---

# Bun SQLite

`bun:sqlite` is built into the Bun runtime. Zero native compilation. Fast.

---

## Timeline

- **2024-06-01**: First used in exo. Replaced better-sqlite3.
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
| `valid_until` | YYYY-MM-DD | Date to flag as stale |
| `tags` | string[] | Arbitrary labels |
| `sources` | string[] | URLs or references |

---

## DB path resolution

```bash
# Flag (per-command)
exo search "query" --db ~/notes/brain.db

# Env var (persists in shell)
export EXO_DB=~/notes/brain.db
```

Default: `./brain.db` in the current directory.

---

## MCP server

exo exposes a Model Context Protocol server so Claude Code and Cursor can read and write your brain directly.

```bash
exo setup-mcp   # writes ~/.claude/mcp.json and ~/.cursor/mcp.json
```

Available MCP tools: `brain_search`, `brain_get`, `brain_put`, `brain_list`, `brain_link`, `brain_stats`, `brain_lint_summary`.

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

---

## Lint

`exo lint` surfaces three classes of issues:

- **Stale** — `valid_until` is in the past
- **Low confidence** — `confidence <= 3`
- **Orphaned** — no links in or out, no tags

```bash
exo lint           # all issues
exo lint --json    # machine-readable JSON
```

---

## Development

```bash
git clone https://github.com/yourname/exo
cd exo
bun install
bun run dev      # bun run src/cli.ts
bun test         # run test suite
bun run build    # compile to single binary
```

---

## Roadmap

**Phase 2 — AI compilation layer**
- `exo harvest` — parse Claude Code JSONL sessions into learning pages
- `exo digest` — parse ChatGPT export into concept pages
- `exo embed` — generate vector embeddings (OpenAI text-embedding-3-small)
- `exo query` — semantic search (FTS5 + cosine similarity)

**Phase 3 — portability**
- `exo export` — export to a directory of markdown files
- `exo import` — import from a markdown directory
- Optional sqlite-vec for large brains

---

## License

MIT
