# gbrain

Your personal knowledge brain. CLI + MCP server.

AI coding sessions close and the experience disappears. ChatGPT threads pile up with nowhere to go. Documentation accumulates but never gets flagged as stale. gbrain solves all three.

Store knowledge once. Search it fast. Let LLMs compile raw sessions and conversations into structured pages. Wire it into Claude Code or Cursor as an MCP server and your AI tools can read and write your brain directly.

---

## Install

```bash
bun install -g gbrain
```

Requires [Bun](https://bun.sh) 1.x.

---

## Quick start

```bash
# Create a brain in your current directory
gbrain init

# Add a concept page (reads from stdin)
echo '---
title: FTS5 Prefix Queries
type: concept
confidence: 8
tags: [sqlite, search]
---

# FTS5 Prefix Queries

FTS5 supports prefix queries: embed* matches "embed", "embeddings", "embedded".
' | gbrain put concepts/fts5-prefix-queries

# Search
gbrain search "fts5 prefix"

# Read a page
gbrain get concepts/fts5-prefix-queries

# Cross-reference two pages
gbrain link concepts/fts5-prefix-queries concepts/sqlite

# Wire up to Claude Code / Cursor (one-time)
gbrain setup-mcp
```

---

## Commands

| Command | Description |
|---------|-------------|
| `gbrain init` | Create `brain.db` in the current directory |
| `gbrain get <slug>` | Read a page as markdown |
| `gbrain put <slug>` | Write/update a page from stdin or `--file` |
| `gbrain search <query>` | FTS5 keyword search (`--type`, `--limit`) |
| `gbrain list` | List pages (`--type`, `--tag`, `--limit`) |
| `gbrain link <from> <to>` | Create a cross-reference |
| `gbrain unlink <from> <to>` | Remove a cross-reference |
| `gbrain backlinks <slug>` | Show pages linking to a slug |
| `gbrain tag <slug> <tag>` | Add a tag |
| `gbrain untag <slug> <tag>` | Remove a tag |
| `gbrain tags <slug>` | List tags for a page |
| `gbrain stats` | Brain statistics (counts, DB size) |
| `gbrain lint` | Check for stale, orphaned, and low-confidence pages |
| `gbrain serve` | Start the MCP stdio server |
| `gbrain setup-mcp` | Auto-configure MCP in Claude Code and Cursor |
| `gbrain version` | Print version |

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

- **2024-06-01**: First used in gbrain. Replaced better-sqlite3.
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
gbrain search "query" --db ~/notes/brain.db

# Env var (persists in shell)
export GBRAIN_DB=~/notes/brain.db
```

Default: `./brain.db` in the current directory.

---

## MCP server

gbrain exposes a Model Context Protocol server so Claude Code and Cursor can read and write your brain directly.

```bash
gbrain setup-mcp   # writes ~/.claude/mcp.json and ~/.cursor/mcp.json
```

Available MCP tools: `brain_search`, `brain_get`, `brain_put`, `brain_list`, `brain_link`, `brain_stats`, `brain_lint_summary`.

To configure manually in `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "gbrain": {
      "command": "gbrain",
      "args": ["serve"]
    }
  }
}
```

---

## Lint

`gbrain lint` surfaces three classes of issues:

- **Stale** — `valid_until` is in the past
- **Low confidence** — `confidence <= 3`
- **Orphaned** — no links in or out, no tags

```bash
gbrain lint           # all issues
gbrain lint --json    # machine-readable JSON
```

---

## Development

```bash
git clone https://github.com/yourname/gbrain
cd gbrain
bun install
bun run dev      # bun run src/cli.ts
bun test         # run test suite
bun run build    # compile to single binary
```

---

## Roadmap

**Phase 2 — AI compilation layer**
- `gbrain harvest` — parse Claude Code JSONL sessions into learning pages
- `gbrain digest` — parse ChatGPT export into concept pages
- `gbrain embed` — generate vector embeddings (OpenAI text-embedding-3-small)
- `gbrain query` — semantic search (FTS5 + cosine similarity)

**Phase 3 — portability**
- `gbrain export` — export to a directory of markdown files
- `gbrain import` — import from a markdown directory
- Optional sqlite-vec for large brains

---

## License

MIT
