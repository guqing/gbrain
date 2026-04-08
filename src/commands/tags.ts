import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "tags", description: "List all tags, or tags for a specific page" },
  args: {
    slug: { type: "positional", description: "Page slug (optional — omit to list all tags)", required: false },
    db:   { type: "string", description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);

    // No slug → list all tags with usage counts
    if (!args.slug) {
      const rows = db.query<{ tag: string; count: number }, []>(
        `SELECT t.tag, COUNT(*) as count
         FROM tags t
         GROUP BY t.tag
         ORDER BY count DESC, t.tag ASC`
      ).all();
      if (args.json) { console.log(JSON.stringify(rows)); return; }
      if (rows.length === 0) { console.log("No tags."); return; }
      for (const r of rows) {
        console.log(`#${r.tag}  (${r.count})`);
      }
      return;
    }

    // Slug provided → list tags for that page
    if (!engine.getPage(args.slug)) {
      console.error(`✗ Page not found: ${args.slug}`);
      process.exit(1);
    }
    const tags = engine.getTags(args.slug);
    if (args.json) { console.log(JSON.stringify(tags)); return; }
    if (tags.length === 0) { console.log("No tags."); return; }
    console.log(tags.map((t: string) => `#${t}`).join("  "));
  },
});
