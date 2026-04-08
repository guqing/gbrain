# Query Skill

Semantic search across the brain to answer questions using your accumulated knowledge.

## MCP Tools Available

When the brain is connected via MCP (`gbrain serve`), Claude Code can use:

- `brain_search` — FTS5 keyword search (fast, no API key needed)
- `brain_get` — read a specific page
- `brain_list` — browse by type or tag
- `brain_backlinks` — find what links to a page
- `brain_graph` — visualize the knowledge graph

## CLI Workflow

### Simple keyword search
```bash
gbrain search "sqlite fts5"
gbrain search "react hooks" --type concept
```

### Semantic search (requires embeddings)
```bash
# First embed your pages if not done:
gbrain embed

# Then query with natural language:
gbrain query "how do I handle authentication in bun"
gbrain query "what did I learn about database indexing"
```

### Browse by topic
```bash
gbrain list --type concept
gbrain list --tag typescript
gbrain tags
```

### Follow the graph
```bash
gbrain backlinks concepts/sqlite
gbrain graph concepts/sqlite --depth 2
```

## Query Strategies

1. **Specific question** — `gbrain query "when should I use FTS5 vs LIKE"`
2. **Technology** — `gbrain search "bun sqlite"` to find all related pages
3. **Tag browse** — `gbrain list --tag react` to see everything tagged
4. **Graph walk** — `gbrain graph projects/gbrain` to see connected concepts
5. **Timeline** — `gbrain timeline projects/gbrain` to see what changed and when

## For Claude Code Sessions

Add to your CLAUDE.md:
```
Before answering questions about technology or patterns I've used before,
search the brain: brain_search or brain_get the relevant slug.
```

This gives Claude Code access to your accumulated experience.
