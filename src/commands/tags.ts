import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";

export default defineCommand({
  meta: { name: "tags", description: "List all tags for a page" },
  args: {
    slug: { type: "positional", description: "Page slug", required: true },
    db:   { type: "option", description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const page = db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1").get(args.slug);
    if (!page) { console.error(`✗ Page not found: ${args.slug}`); process.exit(1); }
    const tags = db.query<{ tag: string }, [number]>("SELECT tag FROM tags WHERE page_id = ? ORDER BY tag").all(page.id).map(r => r.tag);
    if (args.json) { console.log(JSON.stringify(tags)); return; }
    if (tags.length === 0) { console.log("No tags."); return; }
    console.log(tags.map(t => `#${t}`).join("  "));
  },
});
