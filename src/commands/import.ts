import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { importFile } from "../core/import-file.ts";
import { statSync } from "fs";
import { relative, extname } from "path";

export default defineCommand({
  meta: { name: "import", description: "Import a markdown file into the brain" },
  args: {
    file: { type: "positional", description: "Path to markdown file", required: true },
    slug: { type: "option", description: "Override slug (default: derived from filename)" },
    db: { type: "option", description: "Path to brain.db" },
    "no-embed": { type: "boolean", description: "Skip embedding generation", default: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);
    const noEmbed = args["no-embed"] ?? false;

    let stat;
    try { stat = statSync(args.file); } catch {
      console.error(`✗ File not found: ${args.file}`);
      process.exit(1);
    }

    if (!stat.isFile()) {
      console.error(`✗ Not a file: ${args.file}`);
      process.exit(1);
    }

    const rel = args.slug ?? relative(process.cwd(), args.file).replace(/\.md$/, '');
    const result = await importFile(engine, args.file, rel, { noEmbed });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const icon = result.status === 'imported' ? '✓' : result.status === 'skipped' ? '·' : '✗';
      console.log(`${icon} ${result.status}: ${result.slug} (${result.chunks} chunks)${result.error ? `\n  ${result.error}` : ''}`);
    }
  },
});
