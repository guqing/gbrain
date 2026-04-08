import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: {
    name: "search",
    description: "Full-text search the brain (FTS5)",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query",
      required: true,
    },
    type:  { type: "string",  description: "Filter by page type (concept, learning, ...)" },
    limit: { type: "string",  description: "Max results (default: 10)" },
    db:    { type: "string",  description: "Path to brain.db" },
    json:  { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const limit = args.limit ? parseInt(args.limit, 10) : 10;

    let results;
    try {
      results = engine.searchKeyword(args.query, { type: args.type, limit });
    } catch {
      console.error(`✗ Search error — try quoting your query: gbrain search "${args.query}"`);
      process.exit(1);
    }

    if (results.length === 0) {
      console.log("No results.");
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    for (const r of results) {
      console.log(`${r.slug}  (${r.type}, score: ${r.score.toFixed(2)})`);
      if (r.snippet) console.log(`  ${r.snippet}`);
      console.log();
    }
  },
});
