import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";

export default defineCommand({
  meta: { name: "untag", description: "Remove a tag from a page" },
  args: {
    slug: { type: "positional", description: "Page slug", required: true },
    tag:  { type: "positional", description: "Tag name", required: true },
    db:   { type: "option", description: "Path to brain.db" },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const page = db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1").get(args.slug);
    if (!page) { console.error(`✗ Page not found: ${args.slug}`); process.exit(1); }
    db.run("DELETE FROM tags WHERE page_id = ? AND tag = ?", [page.id, args.tag]);
    console.log(`✓ Removed #${args.tag} from ${args.slug}`);
  },
});
