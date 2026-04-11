import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SCHEMA } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { callLlm, type FetchFn } from "../commands/compile/llm.ts";
import { runCompile } from "../commands/compile/index.ts";
import { slugify, generateInboxSlug, deconflictSlug } from "../core/utils.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshEngine(): SqliteEngine {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return new SqliteEngine(db);
}

function freshDb(): Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

/** Build a minimal mock fetchFn that returns a compile LLM response. */
function mockFetch(response: Record<string, unknown>): FetchFn {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(response) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
}

const COMPILE_CONFIG = {
  api_key: "test-key",
  base_url: "https://mock.api/v1",
  model: "gpt-test",
};

// ── [A] capture creates inbox page ────────────────────────────────────────────

describe("generateInboxSlug", () => {
  test("produces inbox/ prefix with ISO8601 compact timestamp and 4-char hash", () => {
    const slug = generateInboxSlug("hello world");
    expect(slug).toMatch(/^inbox\/\d{8}T\d{6}Z-[0-9a-f]{4}$/);
  });

  test("different content produces different hashes", () => {
    const a = generateInboxSlug("note A");
    const b = generateInboxSlug("note B");
    // Same timestamp window possible, but hash differs
    const hashA = a.split("-").at(-1);
    const hashB = b.split("-").at(-1);
    expect(hashA).not.toBe(hashB);
  });
});

describe("capture — inbox page creation", () => {
  test("putPage with type=inbox creates an inbox page", () => {
    const engine = freshEngine();
    const slug = generateInboxSlug("test content");
    engine.putPage(slug, { type: "inbox", title: "test content", compiled_truth: "test content" });
    const page = engine.getPage(slug);
    expect(page).not.toBeNull();
    expect(page!.type).toBe("inbox");
    expect(page!.compiled_truth).toBe("test content");
  });

  test("inbox pages appear in stats inbox_count", () => {
    const engine = freshEngine();
    engine.putPage(generateInboxSlug("a"), { type: "inbox", title: "a", compiled_truth: "a" });
    engine.putPage(generateInboxSlug("b"), { type: "inbox", title: "b", compiled_truth: "b" });
    const stats = engine.getStats();
    expect(stats.inbox_count).toBe(2);
  });
});

// ── [B] callLlm — happy path ──────────────────────────────────────────────────

describe("callLlm", () => {
  test("create action — returns parsed CompileItem", async () => {
    const fetch = mockFetch({
      action: "create",
      slug: "react-hooks-guide",
      title: "React Hooks Guide",
      compiled_truth: "React hooks let you use state in function components.",
      timeline_entry: "Initial capture.",
      reasoning: "New topic.",
    });
    const result = await callLlm("Notes about React hooks", [], COMPILE_CONFIG, fetch);
    expect(result.action).toBe("create");
    expect(result.slug).toBe("react-hooks-guide");
    expect(result.title).toBe("React Hooks Guide");
    expect(result.compiled_truth).toBeTruthy();
  });

  test("update action — returns slug and compiled_truth", async () => {
    const fetch = mockFetch({
      action: "update",
      slug: "react-hooks-guide",
      title: "React Hooks Guide",
      compiled_truth: "Updated content.",
      timeline_entry: "Added useEffect notes.",
      reasoning: "Related to existing page.",
    });
    const result = await callLlm("More React hooks", [{ slug: "react-hooks-guide", title: "React Hooks Guide" }], COMPILE_CONFIG, fetch);
    expect(result.action).toBe("update");
    expect(result.slug).toBe("react-hooks-guide");
  });

  test("noise action — empty compiled_truth is allowed", async () => {
    const fetch = mockFetch({
      action: "noise",
      slug: null,
      title: null,
      compiled_truth: "",
      timeline_entry: null,
      reasoning: "Purely conversational.",
    });
    const result = await callLlm("hahaha", [], COMPILE_CONFIG, fetch);
    expect(result.action).toBe("noise");
    expect(result.compiled_truth).toBe("");
  });

  test("strips markdown code fences from LLM response", async () => {
    const inner = JSON.stringify({
      action: "create",
      slug: "test",
      title: "Test",
      compiled_truth: "Some content.",
      timeline_entry: null,
      reasoning: "New.",
    });
    const fetch: FetchFn = async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "```json\n" + inner + "\n```" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const result = await callLlm("test", [], COMPILE_CONFIG, fetch);
    expect(result.action).toBe("create");
  });

  // ── [F] LLM timeout ──────────────────────────────────────────────────────

  test("throws on LLM timeout (AbortError)", async () => {
    const slowFetch: FetchFn = () =>
      new Promise((_, reject) => {
        // Simulate AbortError immediately
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        setTimeout(() => reject(err), 0);
      });
    await expect(callLlm("test", [], COMPILE_CONFIG, slowFetch)).rejects.toThrow("LLM timeout");
  });

  // ── [G] LLM bad JSON ─────────────────────────────────────────────────────

  test("throws on invalid JSON from LLM", async () => {
    const fetch: FetchFn = async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "not json at all" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    await expect(callLlm("test", [], COMPILE_CONFIG, fetch)).rejects.toThrow("invalid JSON");
  });

  test("throws on unknown action value", async () => {
    const fetch = mockFetch({ action: "delete", slug: null, title: null, compiled_truth: "x", timeline_entry: null, reasoning: "" });
    await expect(callLlm("test", [], COMPILE_CONFIG, fetch)).rejects.toThrow("unknown action");
  });

  test("throws on API error status", async () => {
    const fetch: FetchFn = async () =>
      new Response("Unauthorized", { status: 401 });
    await expect(callLlm("test", [], COMPILE_CONFIG, fetch)).rejects.toThrow("LLM API error 401");
  });

  test("throws when api_key is missing", async () => {
    await expect(
      callLlm("test", [], { api_key: undefined }, mockFetch({ action: "noise", slug: null, title: null, compiled_truth: "", timeline_entry: null, reasoning: "" }))
    ).rejects.toThrow("compile.api_key is not set");
  });
});

// ── [H] deconflictSlug ────────────────────────────────────────────────────────

describe("deconflictSlug", () => {
  test("returns slug unchanged when no conflict", () => {
    expect(deconflictSlug("react-hooks", () => false)).toBe("react-hooks");
  });

  test("appends -2 on first conflict", () => {
    const existing = new Set(["react-hooks"]);
    expect(deconflictSlug("react-hooks", (s) => existing.has(s))).toBe("react-hooks-2");
  });

  test("increments to -3 when -2 also conflicts", () => {
    const existing = new Set(["react-hooks", "react-hooks-2"]);
    expect(deconflictSlug("react-hooks", (s) => existing.has(s))).toBe("react-hooks-3");
  });
});

// ── slugify ───────────────────────────────────────────────────────────────────

describe("slugify", () => {
  test("converts to kebab-case", () => {
    expect(slugify("React Hooks Guide")).toBe("react-hooks-guide");
  });

  test("strips special characters", () => {
    // C++ → "c" (letter kept), ++ stripped; & stripped; : stripped
    expect(slugify("C++ & Go: A Comparison")).toBe("c-go-a-comparison");
  });

  test("respects maxLen", () => {
    const long = "a".repeat(100);
    expect(slugify(long, 20).length).toBeLessThanOrEqual(20);
  });

  test("returns empty string for all-special input", () => {
    expect(slugify("!@#$%")).toBe("");
  });
});

// ── [B/C/D/E] runCompile pipeline ────────────────────────────────────────────

describe("runCompile", () => {
  test("[K] empty inbox returns zero counts", async () => {
    const tmpDb = `/tmp/gbrain-compile-test-empty-${Date.now()}.db`;
    const { Database: Db } = await import("bun:sqlite");
    const db = new Db(tmpDb);
    db.exec(SCHEMA);
    db.close();

    const result = await runCompile({
      dbPath: tmpDb,
      limit: 10,
      yes: true,
      interactive: false,
      fetchFn: mockFetch({ action: "noise", slug: null, title: null, compiled_truth: "", timeline_entry: null, reasoning: "" }),
    });
    expect(result.processed).toBe(0);
    expect(result.created).toBe(0);
    expect(result.noise).toBe(0);

    await import("fs").then((fs) => fs.unlinkSync(tmpDb));
  });

  test("[D] create action produces a concept page", async () => {
    // runCompile opens its own DB via loadConfig, so we use a temp file
    const tmpDb = `/tmp/gbrain-compile-test-${Date.now()}.db`;
    const { Database: Db } = await import("bun:sqlite");
    const db = new Db(tmpDb);
    db.exec(SCHEMA);

    // Insert a compile config into brain_meta so runCompile can read api_key
    db.exec(`INSERT INTO brain_meta (key, value) VALUES ('compile.api_key', '"test-key"')`);

    // Add inbox item directly
    const engine = new SqliteEngine(db);
    engine.putPage("inbox/test-0001", {
      type: "inbox",
      title: "React useState hook",
      compiled_truth: "useState lets you add state to function components.",
    });
    db.close();

    const result = await runCompile({
      dbPath: tmpDb,
      limit: 10,
      yes: true,
      interactive: false,
      compileConfig: COMPILE_CONFIG,
      fetchFn: mockFetch({
        action: "create",
        slug: "react-usestate",
        title: "React useState Hook",
        compiled_truth: "useState lets you add state to function components.",
        timeline_entry: "Initial.",
        reasoning: "New concept.",
      }),
    });

    expect(result.created).toBe(1);
    expect(result.noise).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Verify inbox item was removed and concept was created
    const db2 = new Db(tmpDb);
    const engine2 = new SqliteEngine(db2);
    const inbox = engine2.listPages({ type: "inbox" });
    expect(inbox).toHaveLength(0);
    const page = engine2.getPage("react-usestate");
    expect(page).not.toBeNull();
    expect(page!.type).toBe("concept");
    db2.close();

    // Cleanup
    await import("fs").then((fs) => fs.unlinkSync(tmpDb));
  });

  test("[E] noise action logs to brain_meta and removes inbox item", async () => {
    const tmpDb = `/tmp/gbrain-compile-test-${Date.now()}.db`;
    const { Database: Db } = await import("bun:sqlite");
    const db = new Db(tmpDb);
    db.exec(SCHEMA);
    const engine = new SqliteEngine(db);
    engine.putPage("inbox/noise-0001", {
      type: "inbox",
      title: "hahaha",
      compiled_truth: "hahaha",
    });
    db.close();

    await runCompile({
      dbPath: tmpDb,
      limit: 10,
      yes: true,
      interactive: false,
      compileConfig: COMPILE_CONFIG,
      fetchFn: mockFetch({
        action: "noise",
        slug: null,
        title: null,
        compiled_truth: "",
        timeline_entry: null,
        reasoning: "Purely conversational.",
      }),
    });

    const db2 = new Db(tmpDb);
    const engine2 = new SqliteEngine(db2);
    // Inbox item should be gone
    expect(engine2.listPages({ type: "inbox" })).toHaveLength(0);
    // Noise log should have 1 entry
    const raw = engine2.getMeta("compile.noise_log");
    expect(raw).not.toBeNull();
    const log = JSON.parse(raw!);
    expect(log).toHaveLength(1);
    expect(log[0].slug).toBe("inbox/noise-0001");
    db2.close();

    await import("fs").then((fs) => fs.unlinkSync(tmpDb));
  });

  test("[G] LLM error preserves inbox item and records in errors", async () => {
    const tmpDb = `/tmp/gbrain-compile-test-${Date.now()}.db`;
    const { Database: Db } = await import("bun:sqlite");
    const db = new Db(tmpDb);
    db.exec(SCHEMA);
    const engine = new SqliteEngine(db);
    engine.putPage("inbox/error-0001", {
      type: "inbox",
      title: "some note",
      compiled_truth: "some note",
    });
    db.close();

    const badFetch: FetchFn = async () =>
      new Response("bad json {{{{", { status: 200, headers: { "Content-Type": "application/json" } });

    const result = await runCompile({
      dbPath: tmpDb,
      limit: 10,
      yes: true,
      interactive: false,
      fetchFn: badFetch,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.created).toBe(0);

    // Inbox item preserved (write-last pattern)
    const db2 = new Db(tmpDb);
    const engine2 = new SqliteEngine(db2);
    expect(engine2.listPages({ type: "inbox" })).toHaveLength(1);
    db2.close();

    await import("fs").then((fs) => fs.unlinkSync(tmpDb));
  });
});

// ── [L] stats includes inbox_count ───────────────────────────────────────────

describe("getStats — inbox_count", () => {
  test("inbox_count is 0 for empty DB", () => {
    const engine = freshEngine();
    expect(engine.getStats().inbox_count).toBe(0);
  });

  test("inbox_count increments per inbox page", () => {
    const engine = freshEngine();
    for (let i = 0; i < 3; i++) {
      engine.putPage(`inbox/item-${i}`, { type: "inbox", title: `item ${i}`, compiled_truth: `content ${i}` });
    }
    expect(engine.getStats().inbox_count).toBe(3);
  });
});

// ── [M] lint includes inbox queue ────────────────────────────────────────────

describe("getLintReport — inbox_queue", () => {
  test("inbox_queue is 0 when empty", () => {
    const engine = freshEngine();
    const report = engine.getLintReport();
    expect(report.inbox_queue.count).toBe(0);
    expect(report.inbox_queue.oldest_date).toBeNull();
  });

  test("inbox_queue shows pending items", () => {
    const engine = freshEngine();
    engine.putPage("inbox/pending-1", { type: "inbox", title: "Pending Note", compiled_truth: "something" });
    const report = engine.getLintReport();
    expect(report.inbox_queue.count).toBe(1);
  });
});
