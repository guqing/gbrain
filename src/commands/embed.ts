import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { embedBatch } from "../core/embedding.ts";
import { loadConfig } from "../core/config.ts";
import { chunkText } from "../core/chunkers/recursive.ts";
import type { ChunkInput } from "../types.ts";

export default defineCommand({
  meta: { name: "embed", description: "Generate embeddings for pages" },
  args: {
    db:      { type: "string",  description: "Path to brain.db" },
    slug:    { type: "string",  description: "Embed a specific page (default: all missing)" },
    "force": { type: "boolean", description: "Re-embed even if already embedded", default: false },
    "rebuild": { type: "boolean", description: "Clear all embeddings and re-embed from scratch (required when model changes)", default: false },
  },
  async run({ args }) {
    const cfg = loadConfig(args.db ? { db: args.db } : undefined);

    // Check API key is configured (skip for local providers)
    const isLocal = cfg.embed.base_url &&
      (cfg.embed.base_url.includes("localhost") || cfg.embed.base_url.includes("127.0.0.1"));
    if (!cfg.embed.api_key && !isLocal) {
      console.error("✗ No embedding API key configured.");
      console.error("  gbrain config set embed.api_key <key>");
      console.error("  Or: export OPENAI_API_KEY=<key>");
      process.exit(1);
    }

    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);

    // Dimension mismatch guard
    const storedModel = (db.query("SELECT value FROM config WHERE key = 'embedding_model'").get() as { value: string } | null)?.value;
    const configuredModel = cfg.embed.model;

    if (storedModel && storedModel !== configuredModel && !args["rebuild"]) {
      console.error(`✗ Embedding model changed:`);
      console.error(`    stored     = ${storedModel}`);
      console.error(`    configured = ${configuredModel}`);
      console.error(`  Existing embeddings are incompatible with the new model.`);
      console.error(`  Run: gbrain embed --all --rebuild  to clear and re-embed everything.`);
      process.exit(1);
    }

    if (args["rebuild"]) {
      db.exec("DELETE FROM page_embeddings");
      db.exec("DELETE FROM content_chunks WHERE embedding IS NOT NULL");
      console.log("✓ Cleared all existing embeddings.");
    }

    let pages;
    if (args.slug) {
      const p = engine.getPage(args.slug);
      if (!p) { console.error(`✗ Page not found: ${args.slug}`); process.exit(1); }
      pages = [p];
    } else {
      pages = engine.listPages({ limit: 10000 });
    }

    let embedded = 0;
    const total = pages.length;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      if (!args["force"] && !args["rebuild"]) {
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
        process.stdout.write(`[${i + 1}/${total}] Embedding: ${page.slug} ...`);
        const embeddings = await embedBatch(chunkInputs.map(c => c.chunk_text));
        for (let j = 0; j < chunkInputs.length; j++) {
          chunkInputs[j]!.embedding = embeddings[j];
          chunkInputs[j]!.token_count = Math.ceil(chunkInputs[j]!.chunk_text.length / 4);
        }
        engine.upsertChunks(page.slug, chunkInputs);
        embedded++;
        process.stdout.write(` done (${chunkInputs.length} chunks)\n`);
      } catch (e) {
        process.stdout.write(` FAILED\n`);
        console.error(`  ✗ ${e instanceof Error ? e.message : e}`);
      }
    }

    // Persist the model used so future runs can detect mismatch
    if (embedded > 0) {
      db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('embedding_model', ?)", [configuredModel]);
    }

    console.log(`\nDone: ${embedded} pages embedded.`);
  },
});
