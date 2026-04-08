import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { statSync } from "fs";
import type { BrainStats } from "../types.ts";

export default defineCommand({
  meta: { name: "stats", description: "Show brain statistics" },
  args: {
    db:   { type: "option",  description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const db = openDb(dbPath);

    const total = (db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM pages").get()?.n) ?? 0;

    const byType = Object.fromEntries(
      db
        .query<{ type: string; n: number }, []>(
          "SELECT type, COUNT(*) as n FROM pages GROUP BY type ORDER BY n DESC"
        )
        .all()
        .map((r) => [r.type, r.n])
    );

    const links   = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM links").get()?.n ?? 0;
    const tags    = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM tags").get()?.n ?? 0;
    const embeds  = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM page_embeddings").get()?.n ?? 0;
    const ingests = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM ingest_log").get()?.n ?? 0;

    let dbSize = 0;
    try { dbSize = statSync(dbPath).size; } catch { /* ignore */ }

    const stats: BrainStats = {
      totalPages: total,
      byType,
      totalLinks: links,
      totalTags: tags,
      totalEmbeddings: embeds,
      totalIngestLog: ingests,
      dbSizeBytes: dbSize,
    };

    if (args.json) { console.log(JSON.stringify(stats, null, 2)); return; }

    console.log(`Pages:       ${total}`);
    for (const [type, n] of Object.entries(byType)) {
      console.log(`  ${type.padEnd(12)} ${n}`);
    }
    console.log(`Links:       ${links}`);
    console.log(`Tags:        ${tags}`);
    console.log(`Embeddings:  ${embeds}`);
    console.log(`Ingest log:  ${ingests}`);
    console.log(`DB size:     ${(dbSize / 1024 / 1024).toFixed(2)} MB`);
  },
});
