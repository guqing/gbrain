import { defineCommand } from "citty";
import { resolveDbPath, openDb, migrateDb } from "../core/db.ts";
import { hybridSearch } from "../core/search/hybrid.ts";
import { keywordSearch } from "../core/search/keyword.ts";

export default defineCommand({
  meta: { name: "query", description: "Semantic + keyword hybrid search" },
  args: {
    db: { type: "option", description: "Path to brain.db" },
    limit: { type: "option", description: "Max results (default 10)", default: "10" },
    keyword: { type: "boolean", description: "Force keyword-only (no vectors)", default: false },
    question: { type: "positional", description: "Search query", required: true },
  },
  async run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const db = openDb(dbPath);
    migrateDb(db);

    const limit = parseInt(args.limit ?? "10", 10);
    const q = args.question as string;

    let results;
    if (args.keyword) {
      results = keywordSearch(db, q, limit);
    } else {
      results = await hybridSearch(db, q, limit);
    }

    if (results.length === 0) {
      console.log("No results found.");
      return;
    }

    for (const r of results) {
      const score = r.score.toFixed(4);
      console.log(`\n[${score}] ${r.slug} (${r.type})`);
      console.log(`  ${r.title}`);
      if (r.snippet) {
        const clean = r.snippet.replace(/<\/?b>/g, "").slice(0, 120);
        console.log(`  ${clean}...`);
      }
    }
    console.log(`\n${results.length} result(s).`);
  },
});
