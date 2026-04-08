import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { serializePage } from "../core/markdown.ts";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

export default defineCommand({
  meta: { name: "export", description: "Export pages to markdown files" },
  args: {
    dir: { type: "positional", description: "Output directory", required: true },
    db: { type: "option", description: "Path to brain.db" },
    type: { type: "option", description: "Filter by type" },
    slug: { type: "option", description: "Export specific slug" },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);
    const dir = args.dir;

    let pages;
    if (args.slug) {
      const p = engine.getPage(args.slug);
      if (!p) { console.error(`✗ Page not found: ${args.slug}`); process.exit(1); }
      pages = [p];
    } else {
      pages = engine.listPages({ type: args.type, limit: 100000 });
    }

    let exported = 0;
    for (const page of pages) {
      const filePath = join(dir, page.slug + '.md');
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, serializePage(page), 'utf-8');
      exported++;
    }

    console.log(`✓ Exported ${exported} pages to ${dir}`);
  },
});
