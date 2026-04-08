import { defineCommand } from "citty";
import { resolveDbPath, openDb, migrateDb } from "../core/db.ts";
import { chunkText } from "../core/chunkers/recursive.ts";
import { embedTexts, embeddingToBlob, EMBEDDING_MODEL } from "../core/embedding.ts";

export default defineCommand({
  meta: { name: "embed", description: "Generate vector embeddings for pages" },
  args: {
    db: { type: "option", description: "Path to brain.db" },
    all: { type: "boolean", description: "Re-embed all pages (not just missing)", default: false },
    slug: { type: "positional", description: "Slug to embed (optional)", required: false },
  },
  async run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const db = openDb(dbPath);
    migrateDb(db);

    let pages: { id: number; slug: string; compiled_truth: string; timeline: string }[];

    if (args.slug) {
      const row = db
        .query<{ id: number; slug: string; compiled_truth: string; timeline: string }, [string]>(
          "SELECT id, slug, compiled_truth, timeline FROM pages WHERE slug = ?"
        )
        .get(args.slug);
      if (!row) {
        console.error(`✗ Page not found: ${args.slug}`);
        process.exit(1);
      }
      pages = [row];
    } else if (args.all) {
      pages = db
        .query<{ id: number; slug: string; compiled_truth: string; timeline: string }, []>(
          "SELECT id, slug, compiled_truth, timeline FROM pages"
        )
        .all();
    } else {
      // Only pages missing embeddings
      pages = db
        .query<{ id: number; slug: string; compiled_truth: string; timeline: string }, []>(
          `SELECT p.id, p.slug, p.compiled_truth, p.timeline FROM pages p
           WHERE NOT EXISTS (SELECT 1 FROM page_embeddings e WHERE e.page_id = p.id)`
        )
        .all();
    }

    if (pages.length === 0) {
      console.log("✓ All pages already have embeddings. Use --all to force re-embed.");
      return;
    }

    console.log(`Embedding ${pages.length} page(s) with ${EMBEDDING_MODEL}...`);

    const deleteStmt = db.prepare("DELETE FROM page_embeddings WHERE page_id = ?");
    const insertStmt = db.prepare(
      "INSERT INTO page_embeddings (page_id, chunk_index, chunk_text, embedding, model) VALUES (?, ?, ?, ?, ?)"
    );

    let totalChunks = 0;
    for (const page of pages) {
      const fullText = [page.compiled_truth, page.timeline].filter(Boolean).join("\n\n");
      const chunks = chunkText(fullText);
      if (chunks.length === 0) {
        console.log(`  skip ${page.slug} (empty)`);
        continue;
      }

      process.stdout.write(`  ${page.slug} (${chunks.length} chunks)...`);

      try {
        const embeddings = await embedTexts(chunks);
        db.transaction(() => {
          deleteStmt.run(page.id);
          embeddings.forEach((emb, i) => {
            insertStmt.run(page.id, i, chunks[i]!, embeddingToBlob(emb), EMBEDDING_MODEL);
          });
        })();
        totalChunks += chunks.length;
        process.stdout.write(" ✓\n");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(` ✗ ${msg}\n`);
      }
    }

    console.log(`\n✓ Done. ${pages.length} page(s), ${totalChunks} chunk(s) embedded.`);
  },
});

