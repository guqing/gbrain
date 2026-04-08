import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { rowToPage, serializePage } from "../core/markdown.ts";
import type { PageRow } from "../types.ts";

export default defineCommand({
  meta: {
    name: "get",
    description: "Read a page by slug",
  },
  args: {
    slug: {
      type: "positional",
      description: "Page slug (e.g. concepts/react-suspense)",
      required: true,
    },
    db: { type: "option", description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const row = db
      .query<PageRow, [string]>(
        "SELECT * FROM pages WHERE slug = ? LIMIT 1"
      )
      .get(args.slug);

    if (!row) {
      console.error(`✗ Page not found: ${args.slug}`);
      process.exit(1);
    }

    const page = rowToPage(row);

    if (args.json) {
      console.log(JSON.stringify(page, null, 2));
    } else {
      console.log(serializePage(page));
    }
  },
});
