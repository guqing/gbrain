import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";

export default defineCommand({
  meta: { name: "tag", description: "Add a tag to a page" },
  args: {
    slug: { type: "positional", description: "Page slug", required: true },
    tag:  { type: "positional", description: "Tag name", required: true },
    db:   { type: "option", description: "Path to brain.db" },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const page = db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1").get(args.slug);
    if (!page) { console.error(`✗ Page not found: ${args.slug}`); process.exit(1); }
    db.run("INSERT OR IGNORE INTO tags (page_id, tag) VALUES (?, ?)", [page.id, args.tag]);
    console.log(`✓ Tagged ${args.slug} with #${args.tag}`);
  },
});
