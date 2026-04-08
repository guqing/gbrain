import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { removeLink } from "../core/links.ts";

export default defineCommand({
  meta: { name: "unlink", description: "Remove a cross-reference between two pages" },
  args: {
    from: { type: "positional", description: "Source slug", required: true },
    to:   { type: "positional", description: "Target slug", required: true },
    db:   { type: "option",  description: "Path to brain.db" },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const ok = removeLink(db, args.from, args.to);
    if (ok) {
      console.log(`✓ Unlinked: ${args.from} → ${args.to}`);
    } else {
      console.error("✗ Link not found or pages don't exist.");
      process.exit(1);
    }
  },
});
