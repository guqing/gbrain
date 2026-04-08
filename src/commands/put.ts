import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { parsePage, frontmatterToJson } from "../core/markdown.ts";
import type { PageRow } from "../types.ts";

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
    file: { type: "option", description: "Path to markdown file (default: stdin)" },
    db:   { type: "option", description: "Path to brain.db" },
    json: { type: "boolean", description: "Output result as JSON", default: false },
  },
  async run({ args }) {
    const db = openDb(resolveDbPath(args.db));

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

    const existing = db
      .query<PageRow, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1")
      .get(args.slug);

    const fmJson = frontmatterToJson(parsed.frontmatter);

    if (existing) {
      db.run(
        `UPDATE pages SET
           type = ?, title = ?, compiled_truth = ?, timeline = ?,
           frontmatter = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE slug = ?`,
        [
          parsed.type,
          parsed.title,
          parsed.compiled_truth,
          parsed.timeline,
          fmJson,
          args.slug,
        ]
      );

      // Sync tags from frontmatter
      syncTags(db, existing.id, parsed.frontmatter.tags ?? []);

      if (args.json) {
        console.log(JSON.stringify({ action: "updated", slug: args.slug }));
      } else {
        console.log(`✓ Updated: ${args.slug}`);
      }
    } else {
      const result = db.run(
        `INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          args.slug,
          parsed.type,
          parsed.title,
          parsed.compiled_truth,
          parsed.timeline,
          fmJson,
        ]
      );

      const pageId = result.lastInsertRowid as number;
      syncTags(db, pageId, parsed.frontmatter.tags ?? []);

      if (args.json) {
        console.log(JSON.stringify({ action: "created", slug: args.slug }));
      } else {
        console.log(`✓ Created: ${args.slug}`);
      }
    }
  },
});

function syncTags(db: ReturnType<typeof openDb>, pageId: number, tags: string[]): void {
  db.run("DELETE FROM tags WHERE page_id = ?", [pageId]);
  for (const tag of tags) {
    db.run("INSERT OR IGNORE INTO tags (page_id, tag) VALUES (?, ?)", [pageId, tag]);
  }
}
