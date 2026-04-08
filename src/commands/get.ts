import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { serializePage } from "../core/markdown.ts";

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
    db: { type: "string", description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const page = engine.getPage(args.slug);

    if (!page) {
      console.error(`✗ Page not found: ${args.slug}`);
      process.exit(1);
    }

    if (args.json) {
      console.log(JSON.stringify(page, null, 2));
    } else {
      console.log(serializePage(page));
    }
  },
});
