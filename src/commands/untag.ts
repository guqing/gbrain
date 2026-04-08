import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "untag", description: "Remove a tag from a page" },
  args: {
    slug: { type: "positional", description: "Page slug", required: true },
    tag:  { type: "positional", description: "Tag name", required: true },
    db:   { type: "string", description: "Path to brain.db" },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    if (!engine.getPage(args.slug)) {
      console.error(`✗ Page not found: ${args.slug}`);
      process.exit(1);
    }
    engine.removeTag(args.slug, args.tag);
    console.log(`✓ Removed #${args.tag} from ${args.slug}`);
  },
});
