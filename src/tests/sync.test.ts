import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { createDb, SCHEMA } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { gitIncrementalSync } from "../commands/sync.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function freshEngine(): SqliteEngine {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return new SqliteEngine(db);
}

function makeNote(title: string, type = "concept", body = "Content here.") {
  return `---
title: ${title}
type: ${type}
confidence: 8
tags: []
---

# ${title}

${body}
`;
}

/** Create a temp git repo, add notes, return { dir } */
function makeTempGitRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "exo-sync-test-"));
  const g = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });

  g("init");
  g("config", "user.email", "test@test.com");
  g("config", "user.name", "Test");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function commit(dir: string, message: string) {
  const g = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  g("add", "-A");
  g("commit", "--allow-empty-message", "-m", message);
}

function headCommit(dir: string): string {
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("gitIncrementalSync — first sync", () => {
  let dir: string;
  let cleanup: () => void;
  let engine: SqliteEngine;

  beforeEach(() => {
    ({ dir, cleanup } = makeTempGitRepo());
    engine = freshEngine();
    writeFileSync(join(dir, "alpha.md"), makeNote("Alpha"));
    writeFileSync(join(dir, "beta.md"), makeNote("Beta"));
    commit(dir, "initial");
  });

  afterEach(() => cleanup());

  test("first sync imports all tracked files", async () => {
    const result = await gitIncrementalSync(engine, dir, { noEmbed: true });
    expect(result.status).toBe("first_sync");
    expect(result.imported).toBe(2);
    expect(result.errors).toBe(0);
    expect(engine.getPage("alpha")).not.toBeNull();
    expect(engine.getPage("beta")).not.toBeNull();
  });

  test("stores last_commit after first sync", async () => {
    await gitIncrementalSync(engine, dir, { noEmbed: true });
    const stored = engine.getConfig("sync.last_commit");
    expect(stored).toBe(headCommit(dir));
  });
});

describe("gitIncrementalSync — incremental", () => {
  let dir: string;
  let cleanup: () => void;
  let engine: SqliteEngine;

  beforeEach(async () => {
    ({ dir, cleanup } = makeTempGitRepo());
    engine = freshEngine();
    // Initial state
    writeFileSync(join(dir, "alpha.md"), makeNote("Alpha"));
    writeFileSync(join(dir, "beta.md"), makeNote("Beta"));
    commit(dir, "initial");
    await gitIncrementalSync(engine, dir, { noEmbed: true });
  });

  afterEach(() => cleanup());

  test("up_to_date when no changes", async () => {
    const result = await gitIncrementalSync(engine, dir, { noEmbed: true });
    expect(result.status).toBe("up_to_date");
    expect(result.imported).toBe(0);
  });

  test("incremental — detects added file", async () => {
    writeFileSync(join(dir, "gamma.md"), makeNote("Gamma"));
    commit(dir, "add gamma");

    const result = await gitIncrementalSync(engine, dir, { noEmbed: true });
    expect(result.status).toBe("incremental");
    expect(result.imported).toBe(1);
    expect(engine.getPage("gamma")).not.toBeNull();
  });

  test("incremental — detects modified file", async () => {
    writeFileSync(join(dir, "alpha.md"), makeNote("Alpha", "concept", "Updated content."));
    commit(dir, "update alpha");

    const result = await gitIncrementalSync(engine, dir, { noEmbed: true });
    expect(result.status).toBe("incremental");
    expect(result.imported).toBe(1);
  });

  test("incremental — deletes page when file removed", async () => {
    rmSync(join(dir, "beta.md"));
    commit(dir, "delete beta");

    const result = await gitIncrementalSync(engine, dir, { noEmbed: true });
    expect(result.status).toBe("incremental");
    expect(result.deleted).toBe(1);
    expect(engine.getPage("beta")).toBeNull();
    // alpha still exists
    expect(engine.getPage("alpha")).not.toBeNull();
  });

  test("incremental — handles rename (updateSlug)", async () => {
    execFileSync("git", ["-C", dir, "mv", "alpha.md", "alpha-renamed.md"], { stdio: "ignore" });
    commit(dir, "rename alpha");

    const result = await gitIncrementalSync(engine, dir, { noEmbed: true });
    expect(result.status).toBe("incremental");
    expect(result.renamed).toBe(1);
    // old slug gone, new slug exists
    expect(engine.getPage("alpha")).toBeNull();
    expect(engine.getPage("alpha-renamed")).not.toBeNull();
  });

  test("updates sync.last_commit after incremental sync", async () => {
    writeFileSync(join(dir, "delta.md"), makeNote("Delta"));
    commit(dir, "add delta");

    const beforeCommit = headCommit(dir);
    await gitIncrementalSync(engine, dir, { noEmbed: true });
    expect(engine.getConfig("sync.last_commit")).toBe(beforeCommit);
  });
});

describe("gitIncrementalSync — ancestry validation", () => {
  let dir: string;
  let cleanup: () => void;
  let engine: SqliteEngine;

  beforeEach(async () => {
    ({ dir, cleanup } = makeTempGitRepo());
    engine = freshEngine();
    writeFileSync(join(dir, "note.md"), makeNote("Note"));
    commit(dir, "initial");
    await gitIncrementalSync(engine, dir, { noEmbed: true });
  });

  afterEach(() => cleanup());

  test("full_reimport when stored commit is a ghost (simulates force push)", async () => {
    // Store a fake (non-existent) commit SHA
    engine.setConfig("sync.last_commit", "0000000000000000000000000000000000000000");

    writeFileSync(join(dir, "extra.md"), makeNote("Extra"));
    commit(dir, "add extra");

    const result = await gitIncrementalSync(engine, dir, { noEmbed: true });
    expect(result.status).toBe("full_reimport");
    // Both files should be in brain after full reimport
    expect(engine.getPage("note")).not.toBeNull();
    expect(engine.getPage("extra")).not.toBeNull();
    // last_commit should now be HEAD
    expect(engine.getConfig("sync.last_commit")).toBe(headCommit(dir));
  });
});

describe("gitIncrementalSync — error cases", () => {
  test("throws descriptive error when not a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exo-nogit-"));
    const engine = freshEngine();
    try {
      await expect(
        gitIncrementalSync(engine, dir, { noEmbed: true })
      ).rejects.toThrow("Not a git repository");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws descriptive error when no commits yet", async () => {
    const { dir, cleanup } = makeTempGitRepo();
    const engine = freshEngine();
    // empty repo, no commits
    try {
      await expect(
        gitIncrementalSync(engine, dir, { noEmbed: true })
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});
