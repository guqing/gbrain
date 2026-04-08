import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { embedBatch } from "../core/embedding.ts";
import { chunkText } from "../core/chunkers/recursive.ts";
import type { ChunkInput } from "../types.ts";

export default defineCommand({
  meta: { name: "embed", description: "Generate embeddings for pages" },
  args: {
    db: { type: "option", description: "Path to brain.db" },
    slug: { type: "option", description: "Embed a specific page (default: all missing)" },
    "force": { type: "boolean", description: "Re-embed even if already embedded", default: false },
  },
  async run({ args }) {
    if (!process.env['OPENAI_API_KEY']) {
      console.error("✗ OPENAI_API_KEY is not set.");
      process.exit(1);
    }

    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);

    let pages;
    if (args.slug) {
      const p = engine.getPage(args.slug);
      if (!p) { console.error(`✗ Page not found: ${args.slug}`); process.exit(1); }
      pages = [p];
    } else {
      pages = engine.listPages({ limit: 10000 });
    }

    let embedded = 0;
    for (const page of pages) {
      if (!args["force"]) {
        const chunks = engine.getChunks(page.slug);
        if (chunks.some(c => c.embedding !== null)) continue;
      }

      const chunkInputs: ChunkInput[] = [];
      if (page.compiled_truth.trim()) {
        for (const c of chunkText(page.compiled_truth)) {
          chunkInputs.push({ chunk_index: chunkInputs.length, chunk_text: c.text, chunk_source: 'compiled_truth' });
        }
      }
      if (page.timeline?.trim()) {
        for (const c of chunkText(page.timeline)) {
          chunkInputs.push({ chunk_index: chunkInputs.length, chunk_text: c.text, chunk_source: 'timeline' });
        }
      }

      if (chunkInputs.length === 0) continue;

      try {
        const embeddings = await embedBatch(chunkInputs.map(c => c.chunk_text));
        for (let i = 0; i < chunkInputs.length; i++) {
          chunkInputs[i]!.embedding = embeddings[i];
          chunkInputs[i]!.token_count = Math.ceil(chunkInputs[i]!.chunk_text.length / 4);
        }
        engine.upsertChunks(page.slug, chunkInputs);
        embedded++;
        console.log(`✓ Embedded: ${page.slug} (${chunkInputs.length} chunks)`);
      } catch (e) {
        console.error(`✗ Failed: ${page.slug}  ${e}`);
      }
    }

    console.log(`\nDone: ${embedded} pages embedded.`);
  },
});
