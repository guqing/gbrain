import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { createLink } from "../core/links.ts";

export default defineCommand({
  meta: { name: "link", description: "Create a cross-reference between two pages" },
  args: {
    from:    { type: "positional", description: "Source slug", required: true },
    to:      { type: "positional", description: "Target slug", required: true },
    context: { type: "option",  description: "Sentence context for this link" },
    db:      { type: "option",  description: "Path to brain.db" },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const result = createLink(db, args.from, args.to, args.context ?? "");
    if (result.ok) {
      console.log(`✓ Linked: ${args.from} → ${args.to}`);
    } else {
      console.error(`✗ ${result.error}`);
      process.exit(1);
    }
  },
});
