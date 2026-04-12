import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { importFile } from "../core/import-file.ts";
import { statSync, readdirSync } from "fs";
import { join, relative, extname, basename, resolve } from "path";

function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(current: string) {
    try {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (extname(entry.name) === ".md") files.push(full);
      }
    } catch { /* ignore */ }
  }
  walk(dir);
  return files;
}

export default defineCommand({
  meta: { name: "import", description: "Import a markdown file or directory into the brain" },
  args: {
    path: { type: "positional", description: "Path to markdown file or directory", required: true },
    slug: { type: "string", description: "Override slug (single-file mode only)" },
    db: { type: "string", description: "Path to brain.db" },
    "no-embed": { type: "boolean", description: "Skip embedding generation", default: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);
    const noEmbed = args["no-embed"] ?? false;

    let stat;
    try { stat = statSync(args.path); } catch {
      console.error(`✗ Not found: ${args.path}`);
      process.exit(1);
    }

    // ── Directory mode ───────────────────────────────────────────────────────
    if (stat.isDirectory()) {
      const files = findMarkdownFiles(args.path);
      if (files.length === 0) {
        console.log("No markdown files found.");
        return;
      }
      const results = [];
      for (const file of files) {
        const slug = relative(args.path, file).replace(/\.md$/, "");
        const result = await importFile(engine, file, slug, { noEmbed });
        results.push(result);
        if (!args.json) {
          const icon = result.status === "imported" ? "✓" : result.status === "skipped" ? "·" : "✗";
          console.log(`${icon} ${result.slug}${result.error ? `  (${result.error})` : ""}`);
        }
      }
      if (args.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        const imported = results.filter(r => r.status === "imported").length;
        const skipped  = results.filter(r => r.status === "skipped").length;
        const errors   = results.filter(r => r.status === "error").length;
        console.log(`\nDone: ${imported} imported, ${skipped} skipped, ${errors} errors`);
      }
      return;
    }

    // ── Single-file mode ─────────────────────────────────────────────────────
    if (!stat.isFile()) {
      console.error(`✗ Not a file or directory: ${args.path}`);
      process.exit(1);
    }

    const relPath = relative(resolve(process.cwd()), resolve(args.path)).replace(/\.md$/, "");
    const rel = args.slug ?? (relPath.startsWith("..") ? basename(args.path, ".md") : relPath);
    const result = await importFile(engine, args.path, rel, { noEmbed });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const icon = result.status === "imported" ? "✓" : result.status === "skipped" ? "·" : "✗";
      console.log(`${icon} ${result.status}: ${result.slug} (${result.chunks} chunks)${result.error ? `\n  ${result.error}` : ""}`);
    }
  },
});
