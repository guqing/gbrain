import { defineCommand } from "citty";
import { resolveDbPath, openDb } from "../core/db.ts";
import { serializePage, rowToPage } from "../core/markdown.ts";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import type { PageRow } from "../types.ts";

export default defineCommand({
  meta: { name: "export", description: "Export all pages to a markdown directory" },
  args: {
    db: { type: "option", description: "Path to brain.db" },
    dir: { type: "option", description: "Output directory (default: ./export)", default: "./export" },
  },
  run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const db = openDb(dbPath);
    const outDir = args.dir ?? "./export";

    const rows = db
      .query<PageRow, []>("SELECT * FROM pages ORDER BY slug")
      .all();

    let count = 0;
    for (const row of rows) {
      const page = rowToPage(row);
      const markdown = serializePage(page);
      const filePath = join(outDir, row.slug + ".md");
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, markdown, "utf-8");
      count++;
    }

    console.log(`✓ Exported ${count} page(s) to ${outDir}/`);
  },
});
