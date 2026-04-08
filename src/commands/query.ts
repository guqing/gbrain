import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { embed } from "../core/embedding.ts";

export default defineCommand({
  meta: { name: "query", description: "Semantic vector search" },
  args: {
    query: { type: "positional", description: "Search query", required: true },
    db: { type: "string", description: "Path to brain.db" },
    limit: { type: "string", description: "Max results (default 10)" },
    type: { type: "string", description: "Filter by page type" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    if (!process.env['OPENAI_API_KEY']) {
      console.error("✗ OPENAI_API_KEY is not set.");
      process.exit(1);
    }

    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);
    const limit = args.limit ? parseInt(args.limit, 10) : 10;

    const embedding = await embed(args.query);
    const results = engine.searchVector(embedding, { limit, type: args.type });

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log("No results.");
      return;
    }

    for (const r of results) {
      console.log(`[${r.score.toFixed(3)}] ${r.slug}  (${r.type})`);
      console.log(`  ${r.chunk_text.slice(0, 120).replace(/\n/g, ' ')}…`);
    }
  },
});
