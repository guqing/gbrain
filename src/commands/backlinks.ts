import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "backlinks", description: "Show pages linking TO a slug" },
  args: {
    slug: { type: "positional", description: "Target slug", required: true },
    db:   { type: "string", description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const links = engine.getBacklinks(args.slug);

    if (args.json) { console.log(JSON.stringify(links, null, 2)); return; }

    if (links.length === 0) {
      console.log(`No pages link to: ${args.slug}`);
      return;
    }
    console.log(`Backlinks to ${args.slug}:`);
    for (const l of links) {
      console.log(`  ${l.from_slug}${l.context ? `  — ${l.context}` : ""}`);
    }
  },
});
