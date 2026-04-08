import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "timeline", description: "View or add timeline entries for a page" },
  args: {
    slug: { type: "positional", description: "Page slug", required: true },
    db: { type: "option", description: "Path to brain.db" },
    add: { type: "boolean", description: "Add a new entry (reads from stdin)", default: false },
    date: { type: "option", description: "Entry date (YYYY-MM-DD)" },
    summary: { type: "option", description: "Entry summary" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);

    if (args.add) {
      if (!args.date || !args.summary) {
        console.error("✗ --date and --summary are required when using --add");
        process.exit(1);
      }
      engine.addTimelineEntry(args.slug, {
        date: args.date,
        summary: args.summary,
      });
      console.log(`✓ Added timeline entry to: ${args.slug}`);
      return;
    }

    const entries = engine.getTimeline(args.slug);
    if (args.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      console.log("No timeline entries.");
      return;
    }

    for (const e of entries) {
      console.log(`${e.entry_date}  ${e.summary}`);
      if (e.detail) console.log(`  ${e.detail}`);
    }
  },
});
