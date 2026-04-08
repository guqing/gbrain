import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb, SCHEMA } from "../core/db.ts";
import { parsePage, serializePage, rowToPage, frontmatterToJson } from "../core/markdown.ts";
import { ftsSearch } from "../core/fts.ts";
import { createLink, getBacklinks, removeLink } from "../core/links.ts";
import type { PageRow } from "../types.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function freshDb(): Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

function insertPage(db: Database, slug: string, title: string, type: string, compiled_truth: string, timeline = "") {
  return db.run(
    "INSERT INTO pages (slug, type, title, compiled_truth, timeline) VALUES (?,?,?,?,?)",
    [slug, type, title, compiled_truth, timeline]
  );
}

// ── markdown ─────────────────────────────────────────────────────────────────

describe("parsePage", () => {
  test("parses frontmatter and compiled_truth", () => {
    const raw = `---
title: React Hooks
type: concept
confidence: 8
tags: [react, hooks]
---

# React Hooks

Hooks let you use state in function components.

## When to use

Always prefer hooks over class components in React 16.8+.`;

    const page = parsePage(raw, "concepts/react-hooks");
    expect(page.title).toBe("React Hooks");
    expect(page.type).toBe("concept");
    expect(page.frontmatter.confidence).toBe(8);
    expect(page.frontmatter.tags).toEqual(["react", "hooks"]);
    expect(page.compiled_truth).toContain("Hooks let you use state");
    expect(page.timeline).toBe("");
  });

  test("splits compiled_truth and timeline on --- separator", () => {
    const raw = `---
title: Bun SQLite
type: concept
---

# Bun SQLite

Built-in SQLite in Bun runtime.

---

## Timeline

- **2026-04-01**: First used in production.`;

    const page = parsePage(raw, "concepts/bun-sqlite");
    expect(page.compiled_truth).toContain("Built-in SQLite");
    expect(page.timeline).toContain("2026-04-01");
  });

  test("infers type from slug prefix", () => {
    const raw = `---\ntitle: Test\n---\n\nContent.`;
    expect(parsePage(raw, "people/alice").type).toBe("person");
    expect(parsePage(raw, "projects/gbrain").type).toBe("project");
    expect(parsePage(raw, "concepts/whatever").type).toBe("concept");
  });

  test("infers title from H1 when frontmatter has no title", () => {
    const raw = `---\ntype: concept\n---\n\n# My Great Concept\n\nContent here.`;
    const page = parsePage(raw, "concepts/my-great-concept");
    expect(page.title).toBe("My Great Concept");
  });
});

describe("serializePage", () => {
  test("round-trips a page with timeline", () => {
    const raw = `---
title: Test Page
type: concept
confidence: 7
---

# Test Page

Some content.

---

## Timeline

- **2026-01-01**: Origin.`;

    const parsed = parsePage(raw, "concepts/test");
    const serialized = serializePage(parsed);
    const reparsed = parsePage(serialized, "concepts/test");

    expect(reparsed.title).toBe("Test Page");
    expect(reparsed.frontmatter.confidence).toBe(7);
    expect(reparsed.compiled_truth).toContain("Some content");
    expect(reparsed.timeline).toContain("2026-01-01");
  });

  test("serializes without timeline when empty", () => {
    const page = {
      title: "Simple",
      type: "concept" as const,
      compiled_truth: "# Simple\n\nJust content.",
      timeline: "",
      frontmatter: { confidence: 9 },
    };
    const out = serializePage(page);
    expect(out).not.toContain("## Timeline");
  });
});

// ── database + FTS ───────────────────────────────────────────────────────────

describe("FTS5 search", () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
    insertPage(db, "concepts/react-hooks", "React Hooks", "concept", "Hooks let you use state in function components without writing a class.");
    insertPage(db, "concepts/bun-sqlite", "Bun SQLite", "concept", "Bun has a built-in SQLite database driver with zero dependencies.");
    insertPage(db, "learnings/2026-04", "April Learnings", "learning", "Learned about vector embeddings and cosine similarity this month.");
  });

  test("finds pages by keyword", () => {
    const results = ftsSearch(db, "hooks");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.slug).toBe("concepts/react-hooks");
  });

  test("finds pages by word with FTS5 prefix query", () => {
    const results = ftsSearch(db, "embed*");
    expect(results.some(r => r.slug === "learnings/2026-04")).toBe(true);
  });

  test("filters by type", () => {
    const results = ftsSearch(db, "SQLite", { type: "learning" });
    expect(results.length).toBe(0);
  });

  test("returns empty for no match", () => {
    const results = ftsSearch(db, "xyzunknownterm999");
    expect(results).toHaveLength(0);
  });

  test("respects limit", () => {
    const results = ftsSearch(db, "concept", { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// ── links ────────────────────────────────────────────────────────────────────

describe("links", () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
    insertPage(db, "concepts/a", "A", "concept", "Page A links to [[concepts/b]].");
    insertPage(db, "concepts/b", "B", "concept", "Page B.");
    insertPage(db, "concepts/c", "C", "concept", "Page C.");
  });

  test("creates a link between pages", () => {
    const result = createLink(db, "concepts/a", "concepts/b", "A mentions B");
    expect(result.ok).toBe(true);
  });

  test("returns backlinks", () => {
    createLink(db, "concepts/a", "concepts/b");
    const backlinks = getBacklinks(db, "concepts/b");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]!.slug).toBe("concepts/a");
  });

  test("fails gracefully for missing page", () => {
    const result = createLink(db, "concepts/missing", "concepts/b");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("removes a link", () => {
    createLink(db, "concepts/a", "concepts/b");
    const removed = removeLink(db, "concepts/a", "concepts/b");
    expect(removed).toBe(true);
    expect(getBacklinks(db, "concepts/b")).toHaveLength(0);
  });

  test("duplicate link is ignored (not an error)", () => {
    createLink(db, "concepts/a", "concepts/b");
    const result2 = createLink(db, "concepts/a", "concepts/b");
    expect(result2.ok).toBe(true); // INSERT OR IGNORE
  });
});

// ── lint logic ───────────────────────────────────────────────────────────────

describe("lint: staleness detection", () => {
  test("identifies page with past valid_until", () => {
    const db = freshDb();
    db.run(
      "INSERT INTO pages (slug,type,title,compiled_truth,frontmatter) VALUES (?,?,?,?,?)",
      ["concepts/old", "concept", "Old", "Old content.", JSON.stringify({ valid_until: "2020-01-01", confidence: 7 })]
    );
    const today = new Date().toISOString().slice(0, 10)!;
    const rows = db.query<PageRow, []>("SELECT * FROM pages").all();
    const stale = rows.filter(r => {
      const fm = JSON.parse(r.frontmatter) as { valid_until?: string };
      return fm.valid_until && fm.valid_until < today;
    });
    expect(stale).toHaveLength(1);
    expect(stale[0]!.slug).toBe("concepts/old");
  });

  test("does not flag page with future valid_until", () => {
    const db = freshDb();
    db.run(
      "INSERT INTO pages (slug,type,title,compiled_truth,frontmatter) VALUES (?,?,?,?,?)",
      ["concepts/fresh", "concept", "Fresh", "Fresh content.", JSON.stringify({ valid_until: "2099-01-01" })]
    );
    const today = new Date().toISOString().slice(0, 10)!;
    const rows = db.query<PageRow, []>("SELECT * FROM pages").all();
    const stale = rows.filter(r => {
      const fm = JSON.parse(r.frontmatter) as { valid_until?: string };
      return fm.valid_until && fm.valid_until < today;
    });
    expect(stale).toHaveLength(0);
  });
});
