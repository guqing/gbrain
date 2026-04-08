import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SCHEMA } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

function freshEngine(): SqliteEngine {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return new SqliteEngine(db);
}

// ── initSchema ───────────────────────────────────────────────────────────────

describe("initSchema", () => {
  test("is idempotent — calling twice does not throw", () => {
    const engine = freshEngine();
    expect(() => engine.initSchema()).not.toThrow();
    expect(() => engine.initSchema()).not.toThrow();
  });
});

// ── getPage ───────────────────────────────────────────────────────────────────

describe("getPage", () => {
  test("returns null when page does not exist", () => {
    const engine = freshEngine();
    expect(engine.getPage("concepts/missing")).toBeNull();
  });

  test("returns the page when it exists", () => {
    const engine = freshEngine();
    engine.putPage("concepts/alpha", { type: "concept", title: "Alpha", compiled_truth: "Alpha content." });
    const page = engine.getPage("concepts/alpha");
    expect(page).not.toBeNull();
    expect(page!.slug).toBe("concepts/alpha");
    expect(page!.title).toBe("Alpha");
  });

  test("parses frontmatter from JSON into an object", () => {
    const engine = freshEngine();
    engine.putPage("concepts/fm", { type: "concept", title: "FM", compiled_truth: ".", frontmatter: { confidence: 9 } });
    const page = engine.getPage("concepts/fm");
    expect(page!.frontmatter.confidence).toBe(9);
  });
});

// ── putPage ───────────────────────────────────────────────────────────────────

describe("putPage", () => {
  test("creates a new page", () => {
    const engine = freshEngine();
    const page = engine.putPage("concepts/new", { type: "concept", title: "New", compiled_truth: "Content." });
    expect(page.slug).toBe("concepts/new");
    expect(page.type).toBe("concept");
  });

  test("updates an existing page", () => {
    const engine = freshEngine();
    engine.putPage("concepts/upd", { type: "concept", title: "Old Title", compiled_truth: "Old." });
    engine.putPage("concepts/upd", { type: "concept", title: "New Title", compiled_truth: "New." });
    const page = engine.getPage("concepts/upd");
    expect(page!.title).toBe("New Title");
    expect(page!.compiled_truth).toBe("New.");
  });

  test("syncs tags from frontmatter on create", () => {
    const engine = freshEngine();
    engine.putPage("concepts/tagged", { type: "concept", title: "Tagged", compiled_truth: ".", frontmatter: { tags: ["a", "b"] } });
    expect(engine.getTags("concepts/tagged")).toEqual(["a", "b"]);
  });

  test("syncs tags from frontmatter on update — removes stale tags", () => {
    const engine = freshEngine();
    engine.putPage("concepts/tagged", { type: "concept", title: "T", compiled_truth: ".", frontmatter: { tags: ["a", "b"] } });
    engine.putPage("concepts/tagged", { type: "concept", title: "T", compiled_truth: ".", frontmatter: { tags: ["b", "c"] } });
    expect(engine.getTags("concepts/tagged").sort()).toEqual(["b", "c"]);
  });

  test("stores timeline field", () => {
    const engine = freshEngine();
    engine.putPage("concepts/tl", { type: "concept", title: "TL", compiled_truth: ".", timeline: "## Timeline\n- **2026-01-01**: Start." });
    expect(engine.getPage("concepts/tl")!.timeline).toContain("2026-01-01");
  });
});

// ── deletePage ────────────────────────────────────────────────────────────────

describe("deletePage", () => {
  test("removes the page", () => {
    const engine = freshEngine();
    engine.putPage("concepts/del", { type: "concept", title: "Del", compiled_truth: "." });
    engine.deletePage("concepts/del");
    expect(engine.getPage("concepts/del")).toBeNull();
  });

  test("cascades to tags", () => {
    const engine = freshEngine();
    engine.putPage("concepts/del2", { type: "concept", title: "Del2", compiled_truth: ".", frontmatter: { tags: ["x"] } });
    engine.deletePage("concepts/del2");
    // No error means tags were removed via cascade
    expect(engine.getTags("concepts/del2")).toEqual([]);
  });

  test("cascades to links", () => {
    const engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: "." });
    engine.putPage("concepts/b", { type: "concept", title: "B", compiled_truth: "." });
    engine.addLink("concepts/a", "concepts/b");
    engine.deletePage("concepts/a");
    expect(engine.getBacklinks("concepts/b")).toEqual([]);
  });

  test("is a no-op for unknown slug", () => {
    const engine = freshEngine();
    expect(() => engine.deletePage("concepts/ghost")).not.toThrow();
  });
});

// ── listPages ─────────────────────────────────────────────────────────────────

describe("listPages", () => {
  let engine: SqliteEngine;

  beforeEach(() => {
    engine = freshEngine();
    engine.putPage("concepts/c1", { type: "concept", title: "C1", compiled_truth: "." });
    engine.putPage("concepts/c2", { type: "concept", title: "C2", compiled_truth: "." });
    engine.putPage("people/alice", { type: "person", title: "Alice", compiled_truth: ".", frontmatter: { tags: ["eng"] } });
  });

  test("returns all pages with no filter", () => {
    expect(engine.listPages().length).toBe(3);
  });

  test("filters by type", () => {
    const results = engine.listPages({ type: "concept" });
    expect(results.length).toBe(2);
    expect(results.every(p => p.type === "concept")).toBe(true);
  });

  test("filters by tag", () => {
    const results = engine.listPages({ tag: "eng" });
    expect(results.length).toBe(1);
    expect(results[0]!.slug).toBe("people/alice");
  });

  test("respects limit", () => {
    expect(engine.listPages({ limit: 1 }).length).toBe(1);
  });

  test("returns empty array when no match", () => {
    expect(engine.listPages({ type: "project" })).toEqual([]);
  });
});

// ── searchKeyword ─────────────────────────────────────────────────────────────

describe("searchKeyword", () => {
  let engine: SqliteEngine;

  beforeEach(() => {
    engine = freshEngine();
    engine.putPage("concepts/hooks", { type: "concept", title: "React Hooks", compiled_truth: "Hooks let you use state in functions." });
    engine.putPage("concepts/sqlite", { type: "concept", title: "SQLite", compiled_truth: "SQLite is a serverless database." });
    engine.putPage("people/alice", { type: "person", title: "Alice", compiled_truth: "Alice knows TypeScript well." });
  });

  test("finds a page by keyword in compiled_truth", () => {
    const results = engine.searchKeyword("serverless");
    expect(results.some(r => r.slug === "concepts/sqlite")).toBe(true);
  });

  test("finds a page by keyword in title", () => {
    const results = engine.searchKeyword("Hooks");
    expect(results.some(r => r.slug === "concepts/hooks")).toBe(true);
  });

  test("filters results by type", () => {
    const results = engine.searchKeyword("Alice", { type: "concept" });
    expect(results.length).toBe(0);
  });

  test("returns empty array for unmatched query", () => {
    expect(engine.searchKeyword("zzznomatch999")).toEqual([]);
  });

  test("respects limit option", () => {
    const results = engine.searchKeyword("concept", { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// ── addLink / removeLink / getLinks / getBacklinks ────────────────────────────

describe("links CRUD", () => {
  let engine: SqliteEngine;

  beforeEach(() => {
    engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: "." });
    engine.putPage("concepts/b", { type: "concept", title: "B", compiled_truth: "." });
    engine.putPage("concepts/c", { type: "concept", title: "C", compiled_truth: "." });
  });

  test("addLink creates a link between two pages", () => {
    engine.addLink("concepts/a", "concepts/b", "A references B");
    expect(engine.getLinks("concepts/a").length).toBe(1);
  });

  test("getLinks returns outgoing links with correct shape", () => {
    engine.addLink("concepts/a", "concepts/b", "ctx", "related");
    const links = engine.getLinks("concepts/a");
    expect(links[0]!.from_slug).toBe("concepts/a");
    expect(links[0]!.to_slug).toBe("concepts/b");
    expect(links[0]!.link_type).toBe("related");
    expect(links[0]!.context).toBe("ctx");
  });

  test("getBacklinks returns incoming links", () => {
    engine.addLink("concepts/a", "concepts/b");
    engine.addLink("concepts/c", "concepts/b");
    const back = engine.getBacklinks("concepts/b");
    expect(back.length).toBe(2);
    expect(back.map(l => l.from_slug).sort()).toEqual(["concepts/a", "concepts/c"]);
  });

  test("removeLink deletes a link", () => {
    engine.addLink("concepts/a", "concepts/b");
    engine.removeLink("concepts/a", "concepts/b");
    expect(engine.getLinks("concepts/a")).toEqual([]);
  });

  test("addLink is idempotent (INSERT OR IGNORE)", () => {
    engine.addLink("concepts/a", "concepts/b");
    expect(() => engine.addLink("concepts/a", "concepts/b")).not.toThrow();
    expect(engine.getLinks("concepts/a").length).toBe(1);
  });

  test("addLink throws when from page is missing", () => {
    expect(() => engine.addLink("concepts/ghost", "concepts/b")).toThrow(/not found/);
  });

  test("addLink throws when to page is missing", () => {
    expect(() => engine.addLink("concepts/a", "concepts/ghost")).toThrow(/not found/);
  });

  test("getLinks returns empty array for unknown slug", () => {
    expect(engine.getLinks("concepts/ghost")).toEqual([]);
  });

  test("getBacklinks returns empty array for unknown slug", () => {
    expect(engine.getBacklinks("concepts/ghost")).toEqual([]);
  });
});

// ── traverseGraph ─────────────────────────────────────────────────────────────

describe("traverseGraph", () => {
  test("returns the root node with no links", () => {
    const engine = freshEngine();
    engine.putPage("concepts/root", { type: "concept", title: "Root", compiled_truth: "." });
    const nodes = engine.traverseGraph("concepts/root");
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.slug).toBe("concepts/root");
    expect(nodes[0]!.depth).toBe(0);
  });

  test("traverses connected nodes", () => {
    const engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: "." });
    engine.putPage("concepts/b", { type: "concept", title: "B", compiled_truth: "." });
    engine.putPage("concepts/c", { type: "concept", title: "C", compiled_truth: "." });
    engine.addLink("concepts/a", "concepts/b");
    engine.addLink("concepts/b", "concepts/c");
    const nodes = engine.traverseGraph("concepts/a", 3);
    const slugs = nodes.map(n => n.slug);
    expect(slugs).toContain("concepts/a");
    expect(slugs).toContain("concepts/b");
    expect(slugs).toContain("concepts/c");
  });

  test("depth=0 returns only root", () => {
    const engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: "." });
    engine.putPage("concepts/b", { type: "concept", title: "B", compiled_truth: "." });
    engine.addLink("concepts/a", "concepts/b");
    const nodes = engine.traverseGraph("concepts/a", 0);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.slug).toBe("concepts/a");
  });

  test("does not loop on cycles", () => {
    const engine = freshEngine();
    engine.putPage("concepts/x", { type: "concept", title: "X", compiled_truth: "." });
    engine.putPage("concepts/y", { type: "concept", title: "Y", compiled_truth: "." });
    engine.addLink("concepts/x", "concepts/y");
    engine.addLink("concepts/y", "concepts/x");
    expect(() => engine.traverseGraph("concepts/x", 5)).not.toThrow();
    const nodes = engine.traverseGraph("concepts/x", 5);
    const slugs = nodes.map(n => n.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // no duplicates
  });

  test("returns empty for missing start slug", () => {
    const engine = freshEngine();
    expect(engine.traverseGraph("concepts/ghost")).toEqual([]);
  });
});

// ── addTag / removeTag / getTags ──────────────────────────────────────────────

describe("tags CRUD", () => {
  let engine: SqliteEngine;

  beforeEach(() => {
    engine = freshEngine();
    engine.putPage("concepts/p", { type: "concept", title: "P", compiled_truth: "." });
  });

  test("addTag adds a tag to a page", () => {
    engine.addTag("concepts/p", "rust");
    expect(engine.getTags("concepts/p")).toContain("rust");
  });

  test("getTags returns all tags sorted", () => {
    engine.addTag("concepts/p", "z-tag");
    engine.addTag("concepts/p", "a-tag");
    expect(engine.getTags("concepts/p")).toEqual(["a-tag", "z-tag"]);
  });

  test("removeTag removes a specific tag", () => {
    engine.addTag("concepts/p", "keep");
    engine.addTag("concepts/p", "remove");
    engine.removeTag("concepts/p", "remove");
    expect(engine.getTags("concepts/p")).toEqual(["keep"]);
  });

  test("addTag is idempotent (INSERT OR IGNORE)", () => {
    engine.addTag("concepts/p", "dup");
    engine.addTag("concepts/p", "dup");
    expect(engine.getTags("concepts/p")).toEqual(["dup"]);
  });

  test("getTags returns empty array for unknown slug", () => {
    expect(engine.getTags("concepts/ghost")).toEqual([]);
  });

  test("addTag is a no-op for unknown slug", () => {
    expect(() => engine.addTag("concepts/ghost", "tag")).not.toThrow();
  });
});

// ── addTimelineEntry / getTimeline ────────────────────────────────────────────

describe("timeline entries", () => {
  let engine: SqliteEngine;

  beforeEach(() => {
    engine = freshEngine();
    engine.putPage("people/alice", { type: "person", title: "Alice", compiled_truth: "." });
  });

  test("addTimelineEntry persists an entry", () => {
    engine.addTimelineEntry("people/alice", { date: "2026-01-01", summary: "Joined team.", detail: "Started on the platform team." });
    const entries = engine.getTimeline("people/alice");
    expect(entries.length).toBe(1);
    expect(entries[0]!.summary).toBe("Joined team.");
  });

  test("getTimeline returns entries ordered by date descending", () => {
    engine.addTimelineEntry("people/alice", { date: "2026-01-01", summary: "First." });
    engine.addTimelineEntry("people/alice", { date: "2026-06-01", summary: "Second." });
    const entries = engine.getTimeline("people/alice");
    expect(entries[0]!.entry_date).toBe("2026-06-01");
    expect(entries[1]!.entry_date).toBe("2026-01-01");
  });

  test("getTimeline respects limit option", () => {
    for (let i = 1; i <= 5; i++) {
      engine.addTimelineEntry("people/alice", { date: `2026-0${i}-01`, summary: `Entry ${i}` });
    }
    expect(engine.getTimeline("people/alice", { limit: 2 }).length).toBe(2);
  });

  test("getTimeline returns empty for unknown slug", () => {
    expect(engine.getTimeline("people/ghost")).toEqual([]);
  });

  test("addTimelineEntry throws for missing page", () => {
    expect(() => engine.addTimelineEntry("people/ghost", { date: "2026-01-01", summary: "S" })).toThrow(/not found/);
  });
});

// ── createVersion / getVersions / revertToVersion ─────────────────────────────

describe("page versions", () => {
  let engine: SqliteEngine;

  beforeEach(() => {
    engine = freshEngine();
    engine.putPage("concepts/v", { type: "concept", title: "V1", compiled_truth: "Version one content.", frontmatter: { confidence: 7 } });
  });

  test("createVersion snapshots the current page", () => {
    const v = engine.createVersion("concepts/v");
    expect(v.compiled_truth).toBe("Version one content.");
    expect(v.frontmatter).toMatchObject({ confidence: 7 });
  });

  test("getVersions returns all snapshots", () => {
    engine.createVersion("concepts/v");
    engine.createVersion("concepts/v");
    expect(engine.getVersions("concepts/v").length).toBe(2);
  });

  test("revertToVersion restores compiled_truth", () => {
    const v = engine.createVersion("concepts/v");
    engine.putPage("concepts/v", { type: "concept", title: "V2", compiled_truth: "Version two content." });
    engine.revertToVersion("concepts/v", v.id);
    expect(engine.getPage("concepts/v")!.compiled_truth).toBe("Version one content.");
  });

  test("revertToVersion throws for unknown version id", () => {
    expect(() => engine.revertToVersion("concepts/v", 99999)).toThrow(/not found/);
  });

  test("getVersions returns empty for unknown slug", () => {
    expect(engine.getVersions("concepts/ghost")).toEqual([]);
  });

  test("createVersion throws for missing page", () => {
    expect(() => engine.createVersion("concepts/ghost")).toThrow(/not found/);
  });
});

// ── getStats ──────────────────────────────────────────────────────────────────

describe("getStats", () => {
  test("returns zeros for empty DB", () => {
    const engine = freshEngine();
    const stats = engine.getStats();
    expect(stats.totalPages).toBe(0);
    expect(stats.totalLinks).toBe(0);
    expect(stats.totalTags).toBe(0);
  });

  test("counts pages correctly", () => {
    const engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: "." });
    engine.putPage("people/b", { type: "person", title: "B", compiled_truth: "." });
    const stats = engine.getStats();
    expect(stats.totalPages).toBe(2);
    expect(stats.page_count).toBe(2);
  });

  test("counts links correctly", () => {
    const engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: "." });
    engine.putPage("concepts/b", { type: "concept", title: "B", compiled_truth: "." });
    engine.addLink("concepts/a", "concepts/b");
    expect(engine.getStats().totalLinks).toBe(1);
    expect(engine.getStats().link_count).toBe(1);
  });

  test("counts tags correctly", () => {
    const engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: ".", frontmatter: { tags: ["x", "y"] } });
    expect(engine.getStats().totalTags).toBe(2);
    expect(engine.getStats().tag_count).toBe(2);
  });

  test("byType groups pages by type", () => {
    const engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: "." });
    engine.putPage("concepts/b", { type: "concept", title: "B", compiled_truth: "." });
    engine.putPage("people/alice", { type: "person", title: "Alice", compiled_truth: "." });
    const stats = engine.getStats();
    expect(stats.byType["concept"]).toBe(2);
    expect(stats.byType["person"]).toBe(1);
  });
});

// ── getHealth ─────────────────────────────────────────────────────────────────

describe("getHealth", () => {
  test("returns zero page_count for empty DB", () => {
    const engine = freshEngine();
    const h = engine.getHealth();
    expect(h.page_count).toBe(0);
    expect(h.embed_coverage).toBe(0);
  });

  test("embed_coverage is 0 when no chunks exist", () => {
    const engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: "." });
    expect(engine.getHealth().embed_coverage).toBe(0);
  });

  test("detects stale pages (low confidence)", () => {
    const engine = freshEngine();
    engine.putPage("concepts/stale", { type: "concept", title: "Stale", compiled_truth: ".", frontmatter: { confidence: 2 } });
    engine.putPage("concepts/ok", { type: "concept", title: "OK", compiled_truth: ".", frontmatter: { confidence: 8 } });
    expect(engine.getHealth().stale_pages).toBe(1);
  });

  test("detects stale pages (past valid_until)", () => {
    const engine = freshEngine();
    engine.putPage("concepts/old", { type: "concept", title: "Old", compiled_truth: ".", frontmatter: { valid_until: "2020-01-01", confidence: 7 } });
    expect(engine.getHealth().stale_pages).toBe(1);
  });

  test("missing_embeddings counts pages without chunks", () => {
    const engine = freshEngine();
    engine.putPage("concepts/a", { type: "concept", title: "A", compiled_truth: "." });
    engine.putPage("concepts/b", { type: "concept", title: "B", compiled_truth: "." });
    expect(engine.getHealth().missing_embeddings).toBe(2);
  });
});

// ── upsertChunks / getChunks / deleteChunks ───────────────────────────────────

describe("chunks CRUD", () => {
  let engine: SqliteEngine;

  beforeEach(() => {
    engine = freshEngine();
    engine.putPage("concepts/chunked", { type: "concept", title: "Chunked", compiled_truth: "Some content." });
  });

  test("upsertChunks stores chunks for a page", () => {
    engine.upsertChunks("concepts/chunked", [
      { chunk_index: 0, chunk_text: "First chunk.", chunk_source: "compiled_truth" },
      { chunk_index: 1, chunk_text: "Second chunk.", chunk_source: "compiled_truth" },
    ]);
    const chunks = engine.getChunks("concepts/chunked");
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.chunk_text).toBe("First chunk.");
  });

  test("upsertChunks replaces existing chunks", () => {
    engine.upsertChunks("concepts/chunked", [{ chunk_index: 0, chunk_text: "Old.", chunk_source: "compiled_truth" }]);
    engine.upsertChunks("concepts/chunked", [{ chunk_index: 0, chunk_text: "New.", chunk_source: "compiled_truth" }]);
    const chunks = engine.getChunks("concepts/chunked");
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunk_text).toBe("New.");
  });

  test("stores embedding blob when provided", () => {
    const emb = new Float32Array([0.1, 0.2, 0.3]);
    engine.upsertChunks("concepts/chunked", [{ chunk_index: 0, chunk_text: "Emb.", chunk_source: "compiled_truth", embedding: emb }]);
    const chunks = engine.getChunks("concepts/chunked");
    expect(chunks[0]!.embedding).not.toBeNull();
  });

  test("deleteChunks removes all chunks for a page", () => {
    engine.upsertChunks("concepts/chunked", [{ chunk_index: 0, chunk_text: "X.", chunk_source: "compiled_truth" }]);
    engine.deleteChunks("concepts/chunked");
    expect(engine.getChunks("concepts/chunked")).toEqual([]);
  });

  test("getChunks returns empty array for unknown slug", () => {
    expect(engine.getChunks("concepts/ghost")).toEqual([]);
  });

  test("deleteChunks is a no-op for unknown slug", () => {
    expect(() => engine.deleteChunks("concepts/ghost")).not.toThrow();
  });

  test("upsertChunks throws for missing page", () => {
    expect(() =>
      engine.upsertChunks("concepts/ghost", [{ chunk_index: 0, chunk_text: "X.", chunk_source: "compiled_truth" }])
    ).toThrow(/not found/);
  });
});
