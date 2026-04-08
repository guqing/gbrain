import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "tags", description: "List all tags for a page" },
  args: {
    slug: { type: "positional", description: "Page slug", required: true },
    db:   { type: "string", description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
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
