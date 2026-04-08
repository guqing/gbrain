import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "link", description: "Create a cross-reference between two pages" },
  args: {
    from:    { type: "positional", description: "Source slug", required: true },
    to:      { type: "positional", description: "Target slug", required: true },
    context: { type: "string",  description: "Sentence context for this link" },
    db:      { type: "string",  description: "Path to brain.db" },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    try {
      engine.addLink(args.from, args.to, args.context ?? "");
      console.log(`✓ Linked: ${args.from} → ${args.to}`);
    } catch (e) {
      console.error(`✗ ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }
  },
});
