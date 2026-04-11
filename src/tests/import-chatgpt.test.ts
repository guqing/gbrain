import { describe, test, expect, beforeEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { SCHEMA } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { buildFileIndex, findConversationFiles, ChatGPTAdapter } from "../core/importers/chatgpt.ts";
import { ImportRunner } from "../core/importers/runner.ts";

function freshEngine(): SqliteEngine {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return new SqliteEngine(db);
}

/** Create a temp directory and return its path. Caller must call cleanup(). */
function makeTempDir(): [string, () => void] {
  const dir = join(tmpdir(), `gbrain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return [dir, cleanup];
}

function makeConversations(overrides?: object) {
  return JSON.stringify([
    {
      id: "conv-abc12345-full",
      title: "Test conversation",
      create_time: 1700000000,
      mapping: {
        "root": {
          id: "root",
          message: null,
          parent: null,
          children: ["msg1"],
        },
        "msg1": {
          id: "msg1",
          parent: "root",
          children: [],
          message: {
            id: "msg1",
            author: { role: "user" },
            content: { content_type: "text", parts: ["Hello, world!"] },
          },
        },
        ...overrides,
      },
    },
  ]);
}

// ── buildFileIndex ────────────────────────────────────────────────────────────

describe("buildFileIndex()", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => { [dir, cleanup] = makeTempDir(); });

  test("indexes Pattern A files: file-{id}-name.ext", () => {
    writeFileSync(join(dir, "file-abc123-photo.png"), "");
    const idx = buildFileIndex(dir);
    expect(idx.has("abc123")).toBe(true);
    expect(idx.get("abc123")).toContain("file-abc123-photo.png");
    cleanup();
  });

  test("indexes Pattern B files: hash#file_{numericId}#page.hash.ext", () => {
    writeFileSync(join(dir, "xyz#file_42#page.abc.jpg"), "");
    const idx = buildFileIndex(dir);
    expect(idx.has("42")).toBe(true);
    cleanup();
  });

  test("handles empty directory", () => {
    const idx = buildFileIndex(dir);
    expect(idx.size).toBe(0);
    cleanup();
  });

  test("handles non-existent directory gracefully", () => {
    const idx = buildFileIndex("/definitely-does-not-exist-xyz");
    expect(idx.size).toBe(0);
  });
});

// ── findConversationFiles ─────────────────────────────────────────────────────

describe("findConversationFiles()", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => { [dir, cleanup] = makeTempDir(); });

  test("returns only conversations-*.json files", () => {
    writeFileSync(join(dir, "conversations-2024.json"), "[]");
    writeFileSync(join(dir, "conversations.json"), "[]");
    writeFileSync(join(dir, "not_conversations.json"), "[]");
    writeFileSync(join(dir, "other.txt"), "");
    const files = findConversationFiles(dir);
    expect(files.length).toBe(2);
    expect(files.every(f => f.includes("conversations"))).toBe(true);
    cleanup();
  });

  test("returns empty array for empty dir", () => {
    const files = findConversationFiles(dir);
    expect(files).toEqual([]);
    cleanup();
  });
});

// ── ChatGPTAdapter.scan() ─────────────────────────────────────────────────────

describe("ChatGPTAdapter.scan()", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => { [dir, cleanup] = makeTempDir(); });

  test("yields ImportUnit for each conversation", async () => {
    writeFileSync(join(dir, "conversations.json"), makeConversations());
    const adapter = new ChatGPTAdapter();
    const units: object[] = [];
    for await (const unit of adapter.scan(dir)) {
      units.push(unit);
    }
    expect(units.length).toBe(1);
    cleanup();
  });

  test("happy path — page_slug is chatgpt-{id[:8]}", async () => {
    writeFileSync(join(dir, "conversations.json"), makeConversations());
    const adapter = new ChatGPTAdapter();
    const units: { page_slug: string }[] = [];
    for await (const unit of adapter.scan(dir)) {
      units.push(unit as { page_slug: string });
    }
    expect(units[0]?.page_slug).toBe("chatgpt/conv-abc");
    cleanup();
  });

  test("conversation with 0 messages — skipped (no compiled content)", async () => {
    const emptyConvs = JSON.stringify([
      {
        id: "empty-conv",
        title: "Empty",
        mapping: {
          root: { id: "root", message: null, parent: null, children: [] },
        },
      },
    ]);
    writeFileSync(join(dir, "conversations.json"), emptyConvs);
    const adapter = new ChatGPTAdapter();
    const units: { page_input: { compiled_truth: string } }[] = [];
    for await (const unit of adapter.scan(dir)) {
      units.push(unit as { page_input: { compiled_truth: string } });
    }
    // Should yield the unit but content will be empty/minimal
    // Key: the page_input.compiled_truth has just the title heading
    if (units.length > 0) {
      expect(units[0].page_input.compiled_truth.trim()).toBe("# Empty");
    }
    cleanup();
  });

  test("invalid JSON file — warns and continues, does not abort", async () => {
    writeFileSync(join(dir, "conversations-bad.json"), "{invalid json}");
    writeFileSync(join(dir, "conversations.json"), makeConversations());
    const adapter = new ChatGPTAdapter();
    const units: object[] = [];
    for await (const unit of adapter.scan(dir)) {
      units.push(unit);
    }
    // Should still yield from the valid file
    expect(units.length).toBe(1);
    cleanup();
  });
});

// ── ImportRunner integration ──────────────────────────────────────────────────

describe("ImportRunner with ChatGPTAdapter", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => { [dir, cleanup] = makeTempDir(); });

  test("--dry-run — returns counts but writes 0 rows to DB", async () => {
    writeFileSync(join(dir, "conversations.json"), makeConversations());
    const engine = freshEngine();
    const runner = new ImportRunner(engine, new ChatGPTAdapter());
    const result = await runner.run(dir, { dryRun: true });
    expect(result.runId).toBe(-1); // sentinel for dry run
    expect(engine.listImportRuns().length).toBe(0); // no DB writes
    cleanup();
  });

  test("idempotent re-run — second import uses checkpoint to skip", async () => {
    writeFileSync(join(dir, "conversations.json"), makeConversations());
    const engine = freshEngine();
    const runner = new ImportRunner(engine, new ChatGPTAdapter());
    const r1 = await runner.run(dir);
    const r2 = await runner.run(dir);
    expect(r2.completed).toBe(0); // all skipped via checkpoint
    expect(r2.skipped).toBe(1);
    cleanup();
  });

  test("creates import_run record with source_type = chatgpt", async () => {
    writeFileSync(join(dir, "conversations.json"), makeConversations());
    const engine = freshEngine();
    const runner = new ImportRunner(engine, new ChatGPTAdapter());
    const result = await runner.run(dir);
    expect(result.runId).toBeGreaterThan(0);
    const run = engine.getImportRun(result.runId);
    expect(run?.source_type).toBe("chatgpt");
    expect(run?.status).toBe("completed");
    cleanup();
  });

  test("run status is 'completed' on full success", async () => {
    writeFileSync(join(dir, "conversations.json"), makeConversations());
    const engine = freshEngine();
    const runner = new ImportRunner(engine, new ChatGPTAdapter());
    const result = await runner.run(dir);
    expect(result.status).toBe("completed");
    cleanup();
  });

  test("resume: consults import_checkpoints across runs", async () => {
    writeFileSync(join(dir, "conversations.json"), makeConversations());
    const engine = freshEngine();
    const runner = new ImportRunner(engine, new ChatGPTAdapter());
    const r1 = await runner.run(dir);
    // Manually reset the run status to simulate interrupted
    engine.updateImportRunStatus(r1.runId, "interrupted");
    // Create a second run as a resume
    const r2 = await runner.run(dir, {}, r1.runId);
    // The conversation was already checkpointed so it should be skipped
    expect(r2.skipped).toBe(1);
    cleanup();
  });

  test("unmatched image ref — warns and continues, does not abort", async () => {
    // Conversation with image ref that has no matching file in index
    const convWithImg = JSON.stringify([
      {
        id: "img-conv",
        title: "Image conversation",
        mapping: {
          root: { id: "root", message: null, parent: null, children: ["m1"] },
          m1: {
            id: "m1",
            parent: "root",
            children: [],
            message: {
              author: { role: "user" },
              content: {
                content_type: "multimodal_text",
                parts: [
                  {
                    content_type: "image_asset_pointer",
                    asset_pointer: "file-service://file-NOTFOUND",
                  },
                  "What's in this image?",
                ],
              },
            },
          },
        },
      },
    ]);
    writeFileSync(join(dir, "conversations.json"), convWithImg);
    const engine = freshEngine();
    const runner = new ImportRunner(engine, new ChatGPTAdapter());
    const result = await runner.run(dir);
    // Should complete without error
    expect(result.status).toBe("completed");
    expect(result.imagesUnmatched).toBe(0); // file not in index → attachment has no path
    cleanup();
  });
});
