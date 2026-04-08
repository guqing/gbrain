import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { parsePage } from "../core/markdown.ts";

export default defineCommand({
  meta: {
    name: "put",
    description: "Write or update a page (reads from stdin or --file)",
  },
  args: {
    slug: {
      type: "positional",
      description: "Page slug (e.g. concepts/react-suspense)",
      required: true,
    },
    file: { type: "string", description: "Path to markdown file (default: stdin)" },
    db:   { type: "string", description: "Path to brain.db" },
    json: { type: "boolean", description: "Output result as JSON", default: false },
  },
  async run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));

    let raw: string;
    if (args.file) {
      raw = await Bun.file(args.file).text();
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of Bun.stdin.stream()) {
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString("utf-8");
    }

    if (!raw.trim()) {
      console.error("✗ No content provided. Pipe markdown via stdin or use --file.");
      process.exit(1);
    }

    const parsed = parsePage(raw, args.slug);
    const isUpdate = !!engine.getPage(args.slug);

    // Snapshot version before overwriting an existing page
    if (isUpdate) {
      engine.createVersion(args.slug);
    }

    engine.putPage(args.slug, {
      type: parsed.type,
      title: parsed.title,
      compiled_truth: parsed.compiled_truth,
      timeline: parsed.timeline,
      frontmatter: parsed.frontmatter,
    });

    const action = isUpdate ? "updated" : "created";
    if (args.json) {
      console.log(JSON.stringify({ action, slug: args.slug }));
    } else {
      console.log(`✓ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${args.slug}`);
    }
  },
});
