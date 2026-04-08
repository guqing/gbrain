import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { importFile } from "../core/import-file.ts";
import { readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";

function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(current: string) {
    try {
      const entries = readdirSync(current);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const full = join(current, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (extname(entry) === '.md') {
          files.push(full);
        }
      }
    } catch { /* ignore */ }
  }
  walk(dir);
  return files;
}

export default defineCommand({
  meta: { name: "sync", description: "Sync a directory of markdown files into the brain" },
  args: {
    dir: { type: "positional", description: "Directory to sync", required: true },
    db: { type: "option", description: "Path to brain.db" },
    "no-embed": { type: "boolean", description: "Skip embedding generation", default: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);
    const dir = args.dir;
    const noEmbed = args["no-embed"] ?? false;

    const files = findMarkdownFiles(dir);
    if (files.length === 0) {
      console.log("No markdown files found.");
      return;
    }

    const results = [];
    for (const file of files) {
      const rel = relative(dir, file).replace(/\.md$/, '');
      const result = await importFile(engine, file, rel, { noEmbed });
      results.push(result);
      if (!args.json) {
        const icon = result.status === 'imported' ? '✓' : result.status === 'skipped' ? '·' : '✗';
        console.log(`${icon} ${result.slug}${result.error ? `  (${result.error})` : ''}`);
      }
    }

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      const imported = results.filter(r => r.status === 'imported').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const errors = results.filter(r => r.status === 'error').length;
      console.log(`\nDone: ${imported} imported, ${skipped} skipped, ${errors} errors`);
    }
  },
});
