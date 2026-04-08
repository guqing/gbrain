# Harvest Skill

Extract learnings from Claude Code session logs and save them to the brain.

## When to Use

After a long coding session where you solved something non-trivial. Run this to
capture what worked, what didn't, and the patterns you discovered — before the
context is lost.

## Workflow

1. **Locate session logs**
   ```bash
   ls ~/.claude/projects/*/conversations/*.jsonl
   ```
   Or point to a specific file:
   ```bash
   gbrain harvest ~/.claude/projects/myproject/session.jsonl
   ```

2. **Run harvest** (scans `~/.claude/projects/` by default)
   ```bash
   gbrain harvest
   ```
   Or for a specific project directory:
   ```bash
   gbrain harvest ~/.claude/projects/my-project/
   ```

3. **Review extracted pages**
   ```bash
   gbrain list --type concept --limit 10
   gbrain list --type learning --limit 10
   ```

4. **Curate and improve** — open each extracted page and improve the compiled_truth:
   ```bash
   gbrain get concepts/some-insight | pbcopy
   # Edit in your $EDITOR, then:
   gbrain put concepts/some-insight < improved.md
   ```

5. **Link related pages**
   ```bash
   gbrain link concepts/bun-sqlite concepts/fts5-search --context "SQLite FTS5 works natively with bun:sqlite"
   ```

6. **Embed for semantic search**
   ```bash
   gbrain embed
   ```

## Output Format

Each extracted learning becomes a page in the brain:
- `concepts/X` — technical insight or pattern
- `learnings/X` — how-to or practical technique
- `projects/X` — what was built and key decisions

## Tips

- Run after every significant session, not just when something went wrong
- The brain compounds: each session adds to existing pages, not creates duplicates
- Tag pages with the technology stack: `#bun #sqlite #typescript`
- Set `valid_until` for version-specific knowledge: `valid_until: "2026-01-01"`
