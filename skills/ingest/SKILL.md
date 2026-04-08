# Ingest Skill

Use this skill to ingest meetings, articles, conversations, and documents into the brain.

## Quick Commands

### Write a single page
```bash
gbrain put <slug> < file.md
gbrain put concepts/bun-sqlite --file docs/bun.md
```

### Bulk import a directory
```bash
gbrain import ./notes [--no-embed]
```

### Sync a git repo of markdown files
```bash
gbrain sync --dir ~/notes --since HEAD~10
```

### Add a timeline entry to an existing page
```bash
gbrain timeline add people/john-smith --date 2024-01-15 --summary "Meeting: discussed project X"
gbrain timeline add concepts/react --date 2024-03-01 --summary "React 19 stable released"
```

### Link two pages
```bash
gbrain link people/john-smith projects/myproject --context "John is the lead"
```

### Tag a page
```bash
gbrain tag concepts/bun-sqlite sqlite bun performance
```

## Markdown page format

```markdown
---
title: My Concept
type: concept
tags: [sqlite, performance]
confidence: 8
valid_until: 2025-12-01
---

# My Concept

Main knowledge here...

---

## Timeline

- 2024-01-10: First learned about this
```

## Page types

- `concept` — technical concepts, tools, frameworks
- `learning` — lessons learned, insights
- `person` — people you know
- `project` — projects and products
- `source` — books, papers, articles

## Pattern for meeting notes

1. Create a page for the person: `gbrain put people/john-smith < profile.md`
2. Add timeline entry: `gbrain timeline add people/john-smith --date YYYY-MM-DD --summary "What was discussed"`
3. Link to project: `gbrain link people/john-smith projects/relevant-project`
4. Embed for vector search: `gbrain embed people/john-smith`
