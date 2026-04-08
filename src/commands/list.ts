import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import type { PageRow } from "../types.ts";

export default defineCommand({
  meta: {
    name: "list",
    description: "List pages with optional filters",
  },
  args: {
    type:  { type: "option",  description: "Filter by type (concept, learning, person, project, source)" },
    tag:   { type: "option",  description: "Filter by tag" },
    limit: { type: "option",  description: "Max results (default: 50)" },
    db:    { type: "option",  description: "Path to brain.db" },
    json:  { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const limit = args.limit ? parseInt(args.limit, 10) : 50;

    let rows: PageRow[];

    if (args.tag) {
      rows = db
        .query<PageRow, [string]>(
          `SELECT p.* FROM pages p
           JOIN tags t ON t.page_id = p.id
           WHERE t.tag = ?
           ${args.type ? `AND p.type = '${args.type}'` : ""}
           ORDER BY p.updated_at DESC
           LIMIT ${limit}`
        )
        .all(args.tag);
    } else if (args.type) {
      rows = db
        .query<PageRow, [string]>(
          `SELECT * FROM pages WHERE type = ?
           ORDER BY updated_at DESC LIMIT ${limit}`
        )
        .all(args.type);
    } else {
      rows = db
        .query<PageRow, []>(
          `SELECT * FROM pages ORDER BY updated_at DESC LIMIT ${limit}`
        )
        .all();
    }

    if (rows.length === 0) {
      console.log("No pages found.");
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(rows, null, 2));
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

    for (const row of rows) {
      let conf = "-";
      try {
        const fm = JSON.parse(row.frontmatter) as { confidence?: number };
        if (fm.confidence !== undefined) conf = String(fm.confidence);
      } catch { /* ignore */ }

      console.log(
        [
          row.slug.slice(0, colW[0]!).padEnd(colW[0]!),
          row.type.slice(0, colW[1]!).padEnd(colW[1]!),
          conf.padEnd(colW[2]!),
          row.updated_at.slice(0, 10),
        ].join("  ")
      );
    }
  },
});
