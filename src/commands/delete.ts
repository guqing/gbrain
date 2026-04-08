import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "delete", description: "Delete a page by slug" },
  args: {
    slug: { type: "positional", description: "Page slug", required: true },
    db: { type: "string", description: "Path to brain.db" },
    force: { type: "boolean", description: "Skip confirmation", default: false },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const existing = engine.getPage(args.slug);

    if (!existing) {
      console.error(`✗ Page not found: ${args.slug}`);
      process.exit(1);
    }

    engine.deletePage(args.slug);
    console.log(`✓ Deleted: ${args.slug}`);
  },
});
