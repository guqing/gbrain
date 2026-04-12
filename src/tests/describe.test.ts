import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SCHEMA } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { describeImage } from "../core/vision.ts";
import type { VisionConfig } from "../core/vision.ts";

const VISION_CFG: VisionConfig = {
  model: "openai/gpt-4o",
  api_key: "test-key",
};

function freshEngine(): SqliteEngine {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return new SqliteEngine(db);
}

function insertPage(engine: SqliteEngine, slug: string) {
  engine.putPage(slug, {
    type: "concept",
    title: slug,
    compiled_truth: `# ${slug}`,
  });
}

function attachImg(engine: SqliteEngine, pageSlug: string, fileSlug: string) {
  insertPage(engine, pageSlug);
  engine.attachFileRecord(pageSlug, {
    slug: fileSlug,
    sha256: fileSlug.padEnd(64, "0"),
    file_path: `${fileSlug}.png`,
    original_name: `${fileSlug}.png`,
    mime_type: "image/png",
    size_bytes: 512,
    description: null, processed_at: null,
  });
}

// ── describeImage() ────────────────────────────────────────────────────────────

describe("describeImage()", () => {
  const makeOkFetch = (content: string) =>
    (async (_url: string) =>
      new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

  test("success — returns description string from mock API", async () => {
    const result = await describeImage("base64data", "image/png", VISION_CFG, makeOkFetch("A sunny beach."));
    expect(result).toBe("A sunny beach.");
  });

  test("API 4xx error — throws with status message", async () => {
    const mockFetch = (async () =>
      new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;
    await expect(
      describeImage("base64data", "image/png", VISION_CFG, mockFetch)
    ).rejects.toThrow("401");
  });

  test("injectable fetchFn — can mock different responses", async () => {
    const fetch1 = makeOkFetch("Cats on a roof.");
    const fetch2 = makeOkFetch("Dogs in a park.");
    expect(await describeImage("b64", "image/png", VISION_CFG, fetch1)).toBe("Cats on a roof.");
    expect(await describeImage("b64", "image/png", VISION_CFG, fetch2)).toBe("Dogs in a park.");
  });

  test("empty content in response — throws 'Vision API returned empty content'", async () => {
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: null } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;
    await expect(
      describeImage("base64data", "image/png", VISION_CFG, mockFetch)
    ).rejects.toThrow("empty content");
  });

  test("non-200 response — throws with status code", async () => {
    const mockFetch = (async () =>
      new Response("Rate limit exceeded", { status: 429 })) as unknown as typeof fetch;
    await expect(
      describeImage("base64data", "image/png", VISION_CFG, mockFetch)
    ).rejects.toThrow("429");
  });
});

// ── engine.upsertFileChunk() ───────────────────────────────────────────────────

describe("engine.upsertFileChunk()", () => {
  let engine: SqliteEngine;
  beforeEach(() => {
    engine = freshEngine();
    attachImg(engine, "concepts/test", "img-chunk");
  });

  test("inserts embedding for file description", () => {
    const emb = new Float32Array(4).fill(0.25);
    engine.upsertFileChunk("img-chunk", "a golden sunset", emb, "text-embedding-3-small");
    const db = (engine as unknown as { db: Database }).db;
    const row = db.query<{ chunk_text: string }, [string]>(
      "SELECT chunk_text FROM file_chunks WHERE file_slug = ?",
    ).get("img-chunk");
    expect(row?.chunk_text).toBe("a golden sunset");
  });

  test("replace on second call (same file_slug)", () => {
    const emb1 = new Float32Array(4).fill(0.1);
    const emb2 = new Float32Array(4).fill(0.9);
    engine.upsertFileChunk("img-chunk", "first description", emb1, "model-v1");
    engine.upsertFileChunk("img-chunk", "second description", emb2, "model-v1");
    const db = (engine as unknown as { db: Database }).db;
    const rows = db.query<{ chunk_text: string }, [string]>(
      "SELECT chunk_text FROM file_chunks WHERE file_slug = ?",
    ).all("img-chunk");
    expect(rows.length).toBe(1);
    expect(rows[0].chunk_text).toBe("second description");
  });
});

// ── searchVector with file_chunks ─────────────────────────────────────────────

describe("searchVector with file_chunks", () => {
  let engine: SqliteEngine;
  beforeEach(() => {
    engine = freshEngine();
    attachImg(engine, "concepts/test", "img-vec");
  });

  test("returns file results when description is embedded", () => {
    const emb = new Float32Array(4).fill(0.5);
    engine.upsertFileChunk("img-vec", "a beautiful mountain view", emb, "model");
    const results = engine.searchVector(emb);
    expect(results.some(r => r.result_kind === "file" && r.file_slug === "img-vec")).toBe(true);
  });

  test("title normalized to original_name, not raw slug", () => {
    const emb = new Float32Array(4).fill(0.5);
    engine.upsertFileChunk("img-vec", "mountain photo", emb, "model");
    const results = engine.searchVector(emb);
    const fileResult = results.find(r => r.file_slug === "img-vec");
    expect(fileResult?.title).toBe("img-vec.png"); // original_name from attachImg
  });

  test("file with no embedding — absent from vector results", () => {
    // No upsertFileChunk call — no embedding
    const emb = new Float32Array(4).fill(0.5);
    const results = engine.searchVector(emb);
    expect(results.some(r => r.file_slug === "img-vec")).toBe(false);
  });

  test("provenance_summary populated from file_references", () => {
    const emb = new Float32Array(4).fill(0.5);
    engine.upsertFileChunk("img-vec", "ocean wave photo", emb, "model");
    engine.recordFileReference("concepts/test", "img-vec", {
      source_type: "chatgpt",
      source_ref: "/exports/gpt",
      source_item_id: "conv-1",
    });
    const results = engine.searchVector(emb);
    const fileResult = results.find(r => r.file_slug === "img-vec");
    expect(fileResult?.provenance_summary).toContain("chatgpt");
  });
});

// ── searchKeyword with fts_files ──────────────────────────────────────────────

describe("searchKeyword with fts_files", () => {
  let engine: SqliteEngine;
  beforeEach(() => {
    engine = freshEngine();
    attachImg(engine, "concepts/test", "img-fts");
  });

  test("finds file by description keyword after setFileDescription()", () => {
    engine.setFileDescription("img-fts", "golden retriever puppy playing in the snow");
    const results = engine.searchKeyword("retriever");
    const fileHit = results.find(r => r.result_kind === "file" && r.file_slug === "img-fts");
    expect(fileHit).toBeDefined();
  });

  test("returns file-backed result with parent_page_slug", () => {
    engine.setFileDescription("img-fts", "waterfall in the forest");
    const results = engine.searchKeyword("waterfall");
    const fileHit = results.find(r => r.file_slug === "img-fts");
    expect(fileHit?.parent_page_slug).toBe("concepts/test");
  });

  test("file result has chunk_source = 'file_description'", () => {
    engine.setFileDescription("img-fts", "purple sunset over mountains");
    const results = engine.searchKeyword("purple sunset");
    const fileHit = results.find(r => r.file_slug === "img-fts");
    expect(fileHit?.chunk_source).toBe("file_description");
  });

  test("no match for unrelated keyword", () => {
    engine.setFileDescription("img-fts", "city skyline at night");
    const results = engine.searchKeyword("quantum physics");
    expect(results.some(r => r.file_slug === "img-fts")).toBe(false);
  });
});
