import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "inbox", description: "View the inbox queue (items waiting to be compiled)" },
  args: {
    db:   { type: "string",  description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const items = engine.listPages({ type: "inbox", limit: 1000 });

    if (args.json) {
      const totalChars = items.reduce((sum, p) => sum + p.compiled_truth.length, 0);
      console.log(JSON.stringify({
        count: items.length,
        token_estimate: Math.ceil(totalChars / 4),
        oldest_date: items.length > 0 ? items[items.length - 1]!.created_at : null,
        items: items.map(p => ({ slug: p.slug, title: p.title, created_at: p.created_at })),
      }, null, 2));
      return;
    }

    if (items.length === 0) {
      console.log("✓ Inbox is empty.");
      console.log("  Use 'exo capture <text>' or 'exo harvest' to add items.");
      return;
    }

    const totalChars = items.reduce((sum, p) => sum + p.compiled_truth.length, 0);
    const tokenEst = Math.ceil(totalChars / 4);
    // Sort oldest first for display
    const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const oldest = sorted[0]!.created_at.slice(0, 10);

    console.log(`Inbox: ${items.length} item${items.length === 1 ? "" : "s"}  (~${tokenEst} tokens)  oldest: ${oldest}`);
    console.log();

    for (const item of sorted.slice(0, 20)) {
      const date = item.created_at.slice(0, 10);
      const preview = item.compiled_truth.slice(0, 80).replace(/\n/g, " ");
      const ellipsis = item.compiled_truth.length > 80 ? "…" : "";
      console.log(`  ${date}  ${preview}${ellipsis}`);
    }

    if (items.length > 20) {
      console.log(`  ... and ${items.length - 20} more`);
    }

    console.log();
    console.log(`Run 'exo compile' to process (use --interactive to review each item).`);
  },
});
