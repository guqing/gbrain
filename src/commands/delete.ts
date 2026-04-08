import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";

export default defineCommand({
  meta: { name: "delete", description: "Delete a page by slug" },
  args: {
    slug: { type: "positional", description: "Page slug", required: true },
    db: { type: "option", description: "Path to brain.db" },
    force: { type: "boolean", description: "Skip confirmation", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const existing = db.query<{ id: number; title: string }, [string]>(
      "SELECT id, title FROM pages WHERE slug = ? LIMIT 1"
    ).get(args.slug);

    if (!existing) {
      console.error(`✗ Page not found: ${args.slug}`);
      process.exit(1);
    }

    db.run("DELETE FROM pages WHERE slug = ?", [args.slug]);
    console.log(`✓ Deleted: ${args.slug}`);
  },
});
