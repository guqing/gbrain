// Regression: ISSUE-001 — --no-embed flag broken due to citty --no-* negation convention
// Found by /qa on 2025-06-10
// Report: .gstack/qa-reports/

import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { SCHEMA } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

function freshEngine(): SqliteEngine {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return new SqliteEngine(db);
}

function insertFile(engine: SqliteEngine, slug: string) {
  const pageSlug = "concepts/test-page";
  // Ensure the page exists
  if (!engine.getPage(pageSlug)) {
    engine.putPage(pageSlug, { type: "concept", title: "T", compiled_truth: "# T" });
  }
  engine.attachFileRecord(pageSlug, {
    slug,
    sha256: "deadbeefdeadbeef".repeat(4),
    file_path: `${slug}.pdf`,
    original_name: `${slug}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    description: null,
    processed_at: null,
  });
}

describe("upsertFileChunks — skipEmbed (null embeddings)", () => {
  test("stores chunks with null embeddings when all embeddings are null", () => {
    const engine = freshEngine();
    insertFile(engine, "test-pdf");

    const chunks = [
      { text: "Page 1 content", source: "page-1" },
      { text: "Page 2 content", source: "page-2" },
    ];
    const embeddings: Array<null> = [null, null];

    engine.upsertFileChunks("test-pdf", chunks, embeddings, "text-embedding-3-large");

    const db = engine["db"];
    const rows = db.query<{
      chunk_index: number;
      chunk_text: string;
      chunk_source: string;
      embedding: Buffer | null;
      embedded_at: string | null;
    }, []>(
      "SELECT chunk_index, chunk_text, chunk_source, embedding, embedded_at FROM file_chunks ORDER BY chunk_index",
    ).all();

    expect(rows).toHaveLength(2);
    expect(rows[0]!.chunk_text).toBe("Page 1 content");
    expect(rows[0]!.chunk_source).toBe("page-1");
    expect(rows[0]!.embedding).toBeNull();
    expect(rows[0]!.embedded_at).toBeNull();
    expect(rows[1]!.chunk_text).toBe("Page 2 content");
    expect(rows[1]!.embedding).toBeNull();
  });

  test("stores chunks with real embeddings when embeddings are provided", () => {
    const engine = freshEngine();
    insertFile(engine, "test-pdf-2");

    const chunks = [{ text: "Page content", source: "page-1" }];
    const embeddings: Array<Float32Array> = [new Float32Array([0.1, 0.2, 0.3])];

    engine.upsertFileChunks("test-pdf-2", chunks, embeddings, "text-embedding-3-large");

    const db = engine["db"];
    const row = db.query<{ embedding: Buffer | null; embedded_at: string | null }, []>(
      "SELECT embedding, embedded_at FROM file_chunks",
    ).get();

    expect(row!.embedding).not.toBeNull();
    expect(row!.embedded_at).not.toBeNull();
  });

  test("throws when chunks and embeddings lengths differ", () => {
    const engine = freshEngine();
    insertFile(engine, "test-pdf-3");

    const chunks = [{ text: "Page 1", source: "page-1" }];
    const embeddings: Array<Float32Array | null> = [null, null]; // length mismatch

    expect(() =>
      engine.upsertFileChunks("test-pdf-3", chunks, embeddings, "model"),
    ).toThrow("chunks.length (1) !== embeddings.length (2)");
  });
});
