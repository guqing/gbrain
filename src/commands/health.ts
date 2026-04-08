import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "health", description: "Show brain health metrics" },
  args: {
    db: { type: "option", description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);
    const health = engine.getHealth();

    if (args.json) {
      console.log(JSON.stringify(health, null, 2));
      return;
    }

    console.log(`Pages:              ${health.page_count}`);
    console.log(`Embed coverage:     ${health.embed_coverage}%`);
    console.log(`Stale pages:        ${health.stale_pages}`);
    console.log(`Orphan pages:       ${health.orphan_pages}`);
    console.log(`Missing embeddings: ${health.missing_embeddings}`);
  },
});
