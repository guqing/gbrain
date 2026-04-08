import { defineCommand } from "citty";
import { resolveDbPath, openDb, migrateDb } from "../core/db.ts";
import { parsePage } from "../core/markdown.ts";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectMarkdownFiles(full));
    } else if (entry.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

export default defineCommand({
  meta: { name: "import", description: "Import pages from a markdown directory" },
  args: {
    db: { type: "option", description: "Path to brain.db" },
    dir: { type: "positional", description: "Directory to import from", required: true },
    force: { type: "boolean", description: "Re-import unchanged files", default: false },
  },
  run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const db = openDb(dbPath);
    migrateDb(db);
    const dir = args.dir as string;

    const files = collectMarkdownFiles(dir);
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const upsert = db.prepare(`
      INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        type = excluded.type,
        title = excluded.title,
        compiled_truth = excluded.compiled_truth,
        timeline = excluded.timeline,
        frontmatter = excluded.frontmatter,
        content_hash = excluded.content_hash,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE excluded.content_hash != pages.content_hash
    `);

    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      const hash = hashContent(raw);

      // Derive slug from path relative to import dir
      const rel = file.slice(dir.length + 1).replace(/\.md$/, "");
      const slug = rel.replace(/\\/g, "/"); // normalize on Windows

      // Check if unchanged
      if (!args.force) {
        const existing = db
          .query<{ content_hash: string }, [string]>(
            "SELECT content_hash FROM pages WHERE slug = ?"
          )
          .get(slug);
        if (existing?.content_hash === hash) {
          skipped++;
          continue;
        }
      }

      try {
        const page = parsePage(raw);
        const fm = page.frontmatter;
        const type =
          (fm.type as string) ??
          slug.split("/")[0] ??
          "concept";

        const existed = db
          .query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?")
          .get(slug);

        upsert.run(
          slug,
          type,
          page.title || slug,
          page.compiled_truth,
          page.timeline,
          JSON.stringify(fm),
          hash
        );

        if (existed) updated++;
        else created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${file}: ${msg}`);
      }
    }

    console.log(
      `✓ Import complete: ${created} created, ${updated} updated, ${skipped} skipped (unchanged).`
    );
  },
});
