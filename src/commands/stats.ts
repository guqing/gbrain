import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { statSync } from "fs";

export default defineCommand({
  meta: { name: "stats", description: "Show brain statistics" },
  args: {
    db:   { type: "string",  description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const engine = new SqliteEngine(openDb(dbPath));
    const stats = engine.getStats();

    let dbSizeBytes = 0;
    try { dbSizeBytes = statSync(dbPath).size; } catch { /* ignore */ }
    stats.dbSizeBytes = dbSizeBytes;

    if (args.json) { console.log(JSON.stringify(stats, null, 2)); return; }

    console.log(`Pages:       ${stats.totalPages}`);
    for (const [type, n] of Object.entries(stats.byType)) {
      console.log(`  ${type.padEnd(12)} ${n}`);
    }
    console.log(`Inbox:       ${stats.inbox_count}`);
    console.log(`Links:       ${stats.totalLinks}`);
    console.log(`Tags:        ${stats.totalTags}`);
    console.log(`Embeddings:  ${stats.totalEmbeddings}`);
    console.log(`Ingest log:  ${stats.totalIngestLog}`);
    console.log(`DB size:     ${(dbSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  },
});
