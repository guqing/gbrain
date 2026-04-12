import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SCHEMA, migrateDb } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

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

// ── Schema migration ──────────────────────────────────────────────────────────

describe("schema — files tables", () => {
  test("files table created on fresh init", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    const tbl = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='files'").all();
    expect(tbl.length).toBe(1);
  });

  test("page_files table created on fresh init", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    const tbl = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='page_files'").all();
    expect(tbl.length).toBe(1);
  });

  test("file_references table created", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    const tbl = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='file_references'").all();
    expect(tbl.length).toBe(1);
  });

  test("import_runs table created", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    const tbl = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='import_runs'").all();
    expect(tbl.length).toBe(1);
  });

  test("import_run_items table created", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    const tbl = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='import_run_items'").all();
    expect(tbl.length).toBe(1);
  });

  test("import_checkpoints table created", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    const tbl = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='import_checkpoints'").all();
    expect(tbl.length).toBe(1);
  });

  test("fts_files virtual table created", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    const tbl = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='fts_files'").all();
    expect(tbl.length).toBe(1);
  });

  test("file_chunks table created", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    const tbl = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='file_chunks'").all();
    expect(tbl.length).toBe(1);
  });

  test("migrateDb() is idempotent — calling twice does not throw", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    expect(() => migrateDb(db)).not.toThrow();
    expect(() => migrateDb(db)).not.toThrow();
  });
});

// ── attachFileRecord ──────────────────────────────────────────────────────────

describe("attachFileRecord()", () => {
  let engine: SqliteEngine;
  beforeEach(() => {
    engine = freshEngine();
    insertPage(engine, "concepts/test");
  });

  const makeRecord = (overrides: Partial<Record<string, unknown>> = {}) => ({
    slug: "img-abc123",
    sha256: "deadbeefdeadbeef".repeat(4),
    file_path: "img-abc123.png",
    original_name: "photo.png",
    mime_type: "image/png",
    size_bytes: 1024,
    description: null, processed_at: null,
    ...overrides,
  });

  test("happy path — attaches new file to page", () => {
    const result = engine.attachFileRecord("concepts/test", makeRecord());
    expect(result.slug).toBe("img-abc123");
    expect(result.isDuplicate).toBe(false);
    const files = engine.listFiles("concepts/test");
    expect(files.length).toBe(1);
    expect(files[0].slug).toBe("img-abc123");
  });

  test("SHA256 dedup — same content returns existing slug, no duplicate row", () => {
    engine.attachFileRecord("concepts/test", makeRecord());
    // Attach same sha256 but different slug
    const r2 = engine.attachFileRecord("concepts/test", makeRecord({ slug: "img-xyz" }));
    expect(r2.slug).toBe("img-abc123"); // returns existing slug
    expect(r2.isDuplicate).toBe(true);
    const all = engine.listFiles();
    expect(all.length).toBe(1);
  });

  test("SHA256 dedup same page — page_files link idempotent (INSERT OR IGNORE)", () => {
    engine.attachFileRecord("concepts/test", makeRecord());
    // Second call for same page+file: should not duplicate page_files row
    engine.attachFileRecord("concepts/test", makeRecord({ slug: "img-dup" }));
    const files = engine.listFiles("concepts/test");
    expect(files.length).toBe(1);
  });

  test("throws when page does not exist", () => {
    expect(() =>
      engine.attachFileRecord("nonexistent/page", makeRecord())
    ).toThrow("Page not found");
  });

  test("display_order increments per page", () => {
    insertPage(engine, "concepts/test2");
    engine.attachFileRecord("concepts/test", makeRecord({ slug: "img-1", sha256: "aa".repeat(32) }));
    engine.attachFileRecord("concepts/test", makeRecord({ slug: "img-2", sha256: "bb".repeat(32) }));
    const files = engine.listFiles("concepts/test");
    expect(files.length).toBe(2);
  });
});

// ── detachFile ────────────────────────────────────────────────────────────────

describe("detachFile()", () => {
  let engine: SqliteEngine;
  beforeEach(() => {
    engine = freshEngine();
    insertPage(engine, "concepts/test");
    engine.attachFileRecord("concepts/test", {
      slug: "img-abc",
      sha256: "cc".repeat(32),
      file_path: "img-abc.png",
      original_name: "photo.png",
      mime_type: "image/png",
      size_bytes: 512,
      description: null, processed_at: null,
    });
  });

  test("removes page_files link", () => {
    engine.detachFile("concepts/test", "img-abc", false);
    expect(engine.listFiles("concepts/test").length).toBe(0);
  });

  test("purge: deletes file row when no other page refs it, returns file_path", () => {
    const path = engine.detachFile("concepts/test", "img-abc", true);
    expect(path).toBe("img-abc.png");
    expect(engine.getFile("img-abc")).toBeNull();
  });

  test("purge: keeps file row when other pages still reference it", () => {
    insertPage(engine, "concepts/other");
    // Attach same file (same sha256) to second page
    engine.attachFileRecord("concepts/other", {
      slug: "img-abc-dup",
      sha256: "cc".repeat(32),
      file_path: "img-abc.png",
      original_name: "photo.png",
      mime_type: "image/png",
      size_bytes: 512,
      description: null, processed_at: null,
    });
    const path = engine.detachFile("concepts/test", "img-abc", true);
    expect(path).toBeNull(); // not purged — still referenced
    expect(engine.getFile("img-abc")).not.toBeNull();
  });

  test("idempotent: detach already-detached file → no-op, returns null", () => {
    engine.detachFile("concepts/test", "img-abc", false);
    // Second call — no error, returns null
    expect(() => engine.detachFile("concepts/test", "img-abc", false)).not.toThrow();
    const result = engine.detachFile("concepts/test", "img-abc", false);
    expect(result).toBeNull();
  });

  test("purge: file_chunks also removed when purging", () => {
    const db = (engine as unknown as { db: Database }).db;
    // Insert a fake chunk
    db.run(
      `INSERT OR REPLACE INTO file_chunks (file_slug, chunk_index, chunk_text, embedding, model)
       VALUES ('img-abc', 0, 'test', X'00000000', 'test-model')`,
    );
    engine.detachFile("concepts/test", "img-abc", true);
    const chunks = db.query<{ n: number }, [string]>(
      "SELECT COUNT(*) as n FROM file_chunks WHERE file_slug = ?",
    ).get("img-abc");
    expect(chunks?.n).toBe(0);
  });
});

// ── recordFileReference ───────────────────────────────────────────────────────

describe("recordFileReference()", () => {
  let engine: SqliteEngine;
  beforeEach(() => {
    engine = freshEngine();
    insertPage(engine, "concepts/test");
    engine.attachFileRecord("concepts/test", {
      slug: "img-ref",
      sha256: "ee".repeat(32),
      file_path: "img-ref.png",
      original_name: "ref.png",
      mime_type: "image/png",
      size_bytes: 256,
      description: null, processed_at: null,
    });
  });

  test("records importer provenance for an attached file", () => {
    engine.recordFileReference("concepts/test", "img-ref", {
      source_type: "chatgpt",
      source_ref: "/exports/chatgpt",
      source_item_id: "conv-123",
    });
    const db = (engine as unknown as { db: Database }).db;
    const row = db.query<{ source_type: string }, [string, string]>(
      "SELECT source_type FROM file_references WHERE page_slug = ? AND file_slug = ?",
    ).get("concepts/test", "img-ref");
    expect(row?.source_type).toBe("chatgpt");
  });

  test("allows multiple references when source_item_id differs", () => {
    engine.recordFileReference("concepts/test", "img-ref", {
      source_type: "chatgpt",
      source_ref: "/exports",
      source_item_id: "conv-1",
    });
    engine.recordFileReference("concepts/test", "img-ref", {
      source_type: "chatgpt",
      source_ref: "/exports",
      source_item_id: "conv-2",
    });
    const db = (engine as unknown as { db: Database }).db;
    const count = db.query<{ n: number }, []>(
      "SELECT COUNT(*) as n FROM file_references",
    ).get();
    expect(count?.n).toBe(2);
  });

  test("no-ops silently when source_type missing", () => {
    // source_type is empty — should not throw
    expect(() =>
      engine.recordFileReference("concepts/test", "img-ref", {
        source_type: "",
        source_ref: "/exports",
      })
    ).not.toThrow();
  });
});

// ── import run methods ────────────────────────────────────────────────────────

describe("import run methods", () => {
  let engine: SqliteEngine;
  beforeEach(() => { engine = freshEngine(); });

  test("createImportRun() creates durable run record", () => {
    const run = engine.createImportRun("chatgpt", "/exports", 10);
    expect(run.id).toBeGreaterThan(0);
    expect(run.status).toBe("running");
    expect(run.source_type).toBe("chatgpt");
    expect(run.total_items).toBe(10);

    const fetched = engine.getImportRun(run.id);
    expect(fetched?.id).toBe(run.id);
  });

  test("upsertImportRunItem() tracks per-item completion", () => {
    const run = engine.createImportRun("chatgpt", "/exports", 1);
    engine.upsertImportRunItem(run.id, "conv-abc", "conversation", "completed", {
      page_slug: "chatgpt/conv-abc",
    });
    const db = (engine as unknown as { db: Database }).db;
    const row = db.query<{ status: string }, [number, string]>(
      "SELECT status FROM import_run_items WHERE import_run_id = ? AND item_key = ?",
    ).get(run.id, "conv-abc");
    expect(row?.status).toBe("completed");
  });

  test("upsertImportCheckpoint() tracks source-level completion across runs", () => {
    engine.upsertImportCheckpoint({
      source_type: "chatgpt",
      source_ref: "/exports",
      item_key: "conv-xyz",
      item_type: "conversation",
      status: "completed",
      page_slug: "chatgpt/conv-xyz",
    });
    const cp = engine.getImportCheckpoint("chatgpt", "/exports", "conv-xyz");
    expect(cp?.status).toBe("completed");
    expect(cp?.page_slug).toBe("chatgpt/conv-xyz");
  });

  test("resume-safe: checkpoint from prior run is found on second run", () => {
    // Simulate first run completing conv-1
    engine.upsertImportCheckpoint({
      source_type: "chatgpt",
      source_ref: "/exports",
      item_key: "conv-1",
      item_type: "conversation",
      status: "completed",
    });
    // Second run checks checkpoint
    const cp = engine.getImportCheckpoint("chatgpt", "/exports", "conv-1");
    expect(cp).not.toBeNull();
    expect(cp?.status).toBe("completed");
  });
});

// ── listFiles ─────────────────────────────────────────────────────────────────

describe("listFiles()", () => {
  let engine: SqliteEngine;
  beforeEach(() => {
    engine = freshEngine();
    insertPage(engine, "concepts/pg1");
    insertPage(engine, "concepts/pg2");
  });

  const attach = (page: string, slug: string, sha: string) =>
    engine.attachFileRecord(page, {
      slug,
      sha256: sha.padEnd(64, "0"),
      file_path: `${slug}.png`,
      original_name: `${slug}.png`,
      mime_type: "image/png",
      size_bytes: 100,
      description: null, processed_at: null,
    });

  test("with pageSlug — returns only that page's files in display_order", () => {
    attach("concepts/pg1", "f1", "a1");
    attach("concepts/pg1", "f2", "a2");
    attach("concepts/pg2", "f3", "a3");
    const files = engine.listFiles("concepts/pg1");
    expect(files.length).toBe(2);
    expect(files.map(f => f.slug)).toEqual(["f1", "f2"]);
  });

  test("without pageSlug — returns all files", () => {
    attach("concepts/pg1", "f1", "b1");
    attach("concepts/pg2", "f2", "b2");
    expect(engine.listFiles().length).toBe(2);
  });

  test("returns empty array when no files", () => {
    expect(engine.listFiles("concepts/pg1")).toEqual([]);
    expect(engine.listFiles()).toEqual([]);
  });
});

// ── setFileDescription ────────────────────────────────────────────────────────

describe("setFileDescription()", () => {
  let engine: SqliteEngine;
  beforeEach(() => {
    engine = freshEngine();
    insertPage(engine, "concepts/test");
    engine.attachFileRecord("concepts/test", {
      slug: "img-desc",
      sha256: "ff".repeat(32),
      file_path: "img-desc.png",
      original_name: "desc.png",
      mime_type: "image/png",
      size_bytes: 300,
      description: null, processed_at: null,
    });
  });

  test("sets description and file row is updated", () => {
    engine.setFileDescription("img-desc", "A beautiful sunset over the ocean");
    const f = engine.getFile("img-desc");
    expect(f?.description).toBe("A beautiful sunset over the ocean");
  });

  test("fts_files updated via trigger — file findable by description keyword", () => {
    engine.setFileDescription("img-desc", "golden retriever playing fetch");
    const db = (engine as unknown as { db: Database }).db;
    // fts_files is an external content FTS table — join via rowid
    const rows = db.query<{ slug: string }, [string]>(
      `SELECT f.slug FROM files f
       JOIN fts_files ON fts_files.rowid = f.rowid
       WHERE fts_files MATCH ?`,
    ).all("retriever");
    expect(rows.some(r => r.slug === "img-desc")).toBe(true);
  });

  test("throws when file does not exist", () => {
    expect(() => engine.setFileDescription("nonexistent", "desc")).toThrow("File not found");
  });
});
