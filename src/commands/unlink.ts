import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "unlink", description: "Remove a cross-reference between two pages" },
  args: {
    from: { type: "positional", description: "Source slug", required: true },
    to:   { type: "positional", description: "Target slug", required: true },
    db:   { type: "string",  description: "Path to brain.db" },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    try {
      engine.removeLink(args.from, args.to);
      console.log(`✓ Unlinked: ${args.from} → ${args.to}`);
    } catch {
      console.error("✗ Link not found or pages don't exist.");
      process.exit(1);
    }
  },
});
