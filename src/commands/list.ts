import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: {
    name: "list",
    description: "List pages with optional filters",
  },
  args: {
    type:  { type: "string",  description: "Filter by type (concept, learning, person, project, source)" },
    tag:   { type: "string",  description: "Filter by tag" },
    limit: { type: "string",  description: "Max results (default: 50)" },
    db:    { type: "string",  description: "Path to brain.db" },
    json:  { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const limit = args.limit ? parseInt(args.limit, 10) : 50;

    const pages = engine.listPages({ type: args.type, tag: args.tag, limit });

    if (pages.length === 0) {
      console.log("No pages found.");
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(pages, null, 2));
      return;
    }

    const colW = [40, 10, 8, 10];
    const header = [
      "SLUG".padEnd(colW[0]!),
      "TYPE".padEnd(colW[1]!),
      "CONF".padEnd(colW[2]!),
      "UPDATED",
    ].join("  ");
    console.log(header);
    console.log("-".repeat(header.length));

    for (const page of pages) {
      const conf = page.frontmatter?.confidence !== undefined
        ? String(page.frontmatter.confidence)
        : "-";

      console.log(
        [
          page.slug.slice(0, colW[0]!).padEnd(colW[0]!),
          page.type.slice(0, colW[1]!).padEnd(colW[1]!),
          conf.padEnd(colW[2]!),
          page.updated_at.slice(0, 10),
        ].join("  ")
      );
    }
  },
});
