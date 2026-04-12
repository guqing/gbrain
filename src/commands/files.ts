import { defineCommand } from "citty";
import { existsSync } from "fs";
import { join } from "path";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import type { FileRecord } from "../core/sqlite-engine.ts";
import { getFilesDir } from "../core/files.ts";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

function printTable(files: FileRecord[], filesDir: string): void {
  if (files.length === 0) {
    console.log("No files.");
    return;
  }

  const rows = files.map(f => ({
    slug: f.slug,
    type: f.mime_type.split("/")[1] ?? f.mime_type,
    size: formatSize(f.size_bytes),
    described: f.description ? "yes" : "no",
    original: f.original_name ?? f.slug,
  }));

  // Check if table fits in 80 cols: slug(30) + type(10) + size(8) + described(10) + 4*3 spaces = 70
  const useTabs = rows.some(r => r.slug.length > 28 || r.original.length > 25);

  if (useTabs) {
    for (const r of rows) {
      console.log(r.slug);
      console.log(`  type: ${r.type}  size: ${r.size}  described: ${r.described}  original: ${r.original}`);
    }
  } else {
    const header = `${truncate("SLUG", 30)} ${truncate("TYPE", 12)} ${truncate("SIZE", 10)} ${"DESCRIBED"}`;
    console.log(header);
    console.log("─".repeat(header.length));
    for (const r of rows) {
      console.log(`${truncate(r.slug, 30)} ${truncate(r.type, 12)} ${truncate(r.size, 10)} ${r.described}`);
    }
  }
}

export default defineCommand({
  meta: {
    name: "files",
    description: "List files attached to your brain",
  },
  args: {
    "page-slug": {
      type: "positional",
      description: "Filter by page slug (optional)",
      required: false,
    },
    orphaned: {
      type: "boolean",
      description: "List files whose disk path no longer exists",
      default: false,
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
    db: { type: "string", description: "Path to brain.db" },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const filesDir = getFilesDir();
    const pageSlug = args["page-slug"];

    if (args.orphaned) {
      const all = engine.listFiles();
      const orphaned = all.filter(f => !existsSync(join(filesDir, f.file_path)));
      if (args.json) {
        console.log(JSON.stringify(orphaned, null, 2));
        return;
      }
      if (orphaned.length === 0) {
        console.log("No orphaned files.");
        return;
      }
      console.log(`${orphaned.length} orphaned file(s) (DB record exists, file missing from disk):`);
      for (const f of orphaned) {
        console.log(`  ${f.slug}  ${f.file_path}`);
      }
      return;
    }

    const files = engine.listFiles(pageSlug ?? undefined);

    if (args.json) {
      console.log(JSON.stringify(files, null, 2));
      return;
    }

    printTable(files, filesDir);

    const undescribed = files.filter(f => !f.description && f.mime_type.startsWith("image/"));
    if (undescribed.length > 0) {
      console.log(`\nNext: exo describe --all  (${undescribed.length} image(s) without description)`);
    }
  },
});
