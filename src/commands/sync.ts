import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { importFile } from "../core/import-file.ts";
import { readdirSync, statSync, existsSync, realpathSync } from "fs";
import { join, relative, extname, resolve } from "path";
import { execFileSync } from "child_process";

// ── Content-hash mode helpers ────────────────────────────────────────────────

function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(current: string) {
    try {
      const entries = readdirSync(current);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const full = join(current, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (extname(entry) === '.md') {
          files.push(full);
        }
      }
    } catch { /* ignore */ }
  }
  walk(dir);
  return files;
}

// ── Git helpers ──────────────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 30_000,
  }).trim();
}

function requireGit(cwd: string): string {
  // Verify git available
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("git not found on PATH. Install git or remove --git-only.");
  }

  // Verify git repo and return git root (real path)
  try {
    return git(cwd, "rev-parse", "--show-toplevel");
  } catch {
    throw new Error(
      `Not a git repository: ${cwd}\n  Remove --git-only to sync all .md files, or run 'git init' first.`
    );
  }
}

function pathToSlug(repoRelPath: string): string {
  return repoRelPath.replace(/\.md$/, "").replace(/\\/g, "/");
}

interface DiffManifest {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}

function parseDiff(diffOutput: string): DiffManifest {
  const manifest: DiffManifest = { added: [], modified: [], deleted: [], renamed: [] };
  for (const line of diffOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const status = parts[0]!;
    if (status === "A" && parts[1]?.endsWith(".md")) manifest.added.push(parts[1]);
    else if (status === "M" && parts[1]?.endsWith(".md")) manifest.modified.push(parts[1]);
    else if (status === "D" && parts[1]?.endsWith(".md")) manifest.deleted.push(parts[1]);
    else if (status.startsWith("R") && parts[1] && parts[2]) {
      // R050, R100, etc. → rename with similarity score
      if (parts[2].endsWith(".md")) manifest.renamed.push({ from: parts[1], to: parts[2] });
    }
  }
  return manifest;
}

// ── Git-incremental sync ─────────────────────────────────────────────────────

export interface GitSyncResult {
  status: "up_to_date" | "first_sync" | "incremental" | "full_reimport";
  fromCommit: string | null;
  toCommit: string;
  imported: number;
  deleted: number;
  renamed: number;
  errors: number;
}

export async function gitIncrementalSync(
  engine: SqliteEngine,
  dir: string,
  opts: { noEmbed: boolean }
): Promise<GitSyncResult> {
  // Normalize to real path to handle symlinks (e.g. /tmp → /private/tmp on macOS)
  const absDir = realpathSync(resolve(dir));
  const gitRoot = realpathSync(requireGit(absDir));

  const headCommit = git(gitRoot, "rev-parse", "HEAD");

  const lastCommit = engine.getConfig("sync.last_commit");

  // Ancestry validation
  if (lastCommit) {
    let ancestryOk = true;

    // 1. Verify the stored commit still exists in history
    try {
      git(gitRoot, "cat-file", "-t", lastCommit);
    } catch {
      console.warn(
        `  ⚠ Sync anchor ${lastCommit.slice(0, 8)} missing (force push?). Running full reimport.`
      );
      ancestryOk = false;
    }

    // 2. Verify it's an ancestor of HEAD
    if (ancestryOk) {
      try {
        git(gitRoot, "merge-base", "--is-ancestor", lastCommit, headCommit);
      } catch {
        console.warn(
          `  ⚠ Sync anchor ${lastCommit.slice(0, 8)} is not an ancestor of HEAD (branch switch?). Running full reimport.`
        );
        ancestryOk = false;
      }
    }

    if (!ancestryOk) {
      const result = await fullGitImport(engine, gitRoot, absDir, headCommit, opts);
      engine.setConfig("sync.last_commit", headCommit);
      return { ...result, status: "full_reimport" };
    }
  }

  // Already up to date
  if (lastCommit === headCommit) {
    return { status: "up_to_date", fromCommit: lastCommit, toCommit: headCommit, imported: 0, deleted: 0, renamed: 0, errors: 0 };
  }

  // First sync — import everything
  if (!lastCommit) {
    const result = await fullGitImport(engine, gitRoot, absDir, headCommit, opts);
    engine.setConfig("sync.last_commit", headCommit);
    return { ...result, status: "first_sync" };
  }

  // Incremental — process only changed files
  const diffOutput = git(gitRoot, "diff", "--name-status", "-M", `${lastCommit}..${headCommit}`);
  const manifest = parseDiff(diffOutput);

  // Filter to files under our target dir
  const inDir = (repoRelPath: string): boolean => {
    const abs = join(gitRoot, repoRelPath);
    return abs.startsWith(absDir + "/") || abs === absDir;
  };

  const added = manifest.added.filter(inDir);
  const modified = manifest.modified.filter(inDir);
  const deleted = manifest.deleted.filter(inDir);
  const renamed = manifest.renamed.filter(r => inDir(r.to) || inDir(r.from));

  let imported = 0;
  let deletedCount = 0;
  let renamedCount = 0;
  let errors = 0;

  // Deletes first (prevents slug conflicts)
  for (const path of deleted) {
    const slug = pathToSlug(relative(absDir, join(gitRoot, path)));
    try {
      engine.deletePage(slug);
      deletedCount++;
      console.log(`  ✗ ${slug} (deleted)`);
    } catch { /* page might not exist in brain */ }
  }

  // Renames — updateSlug preserves links, then reimport at new path
  for (const { from, to } of renamed) {
    const oldSlug = pathToSlug(relative(absDir, join(gitRoot, from)));
    const newSlug = pathToSlug(relative(absDir, join(gitRoot, to)));
    try {
      engine.updateSlug(oldSlug, newSlug);
    } catch { /* old slug might not exist */ }
    const filePath = join(gitRoot, to);
    if (existsSync(filePath)) {
      const r = await importFile(engine, filePath, newSlug, opts);
      if (r.status === "imported") imported++;
      else if (r.status === "error") errors++;
    }
    renamedCount++;
    console.log(`  → ${oldSlug} → ${newSlug}`);
  }

  // Adds + modifies
  for (const path of [...added, ...modified]) {
    const filePath = join(gitRoot, path);
    if (!existsSync(filePath)) continue;
    const slug = pathToSlug(relative(absDir, filePath));
    const r = await importFile(engine, filePath, slug, opts);
    const icon = r.status === "imported" ? "✓" : r.status === "skipped" ? "·" : "✗";
    console.log(`  ${icon} ${r.slug}`);
    if (r.status === "imported") imported++;
    else if (r.status === "error") errors++;
  }

  engine.setConfig("sync.last_commit", headCommit);

  return {
    status: "incremental",
    fromCommit: lastCommit,
    toCommit: headCommit,
    imported,
    deleted: deletedCount,
    renamed: renamedCount,
    errors,
  };
}

async function fullGitImport(
  engine: SqliteEngine,
  gitRoot: string,
  absDir: string,
  headCommit: string,
  opts: { noEmbed: boolean }
): Promise<Omit<GitSyncResult, "status">> {
  const output = git(gitRoot, "ls-files", "--full-name");
  const trackedFiles = output
    .split("\n")
    .map(f => f.trim())
    .filter(f => f.endsWith(".md") && f.length > 0)
    .map(f => join(gitRoot, f))
    .filter(f => f.startsWith(absDir + "/") || f === absDir);

  let imported = 0;
  let errors = 0;

  for (const filePath of trackedFiles) {
    const slug = pathToSlug(relative(absDir, filePath));
    const r = await importFile(engine, filePath, slug, opts);
    const icon = r.status === "imported" ? "✓" : r.status === "skipped" ? "·" : "✗";
    console.log(`  ${icon} ${r.slug}`);
    if (r.status === "imported") imported++;
    else if (r.status === "error") errors++;
  }

  return { fromCommit: null, toCommit: headCommit, imported, deleted: 0, renamed: 0, errors };
}

// ── CLI command ──────────────────────────────────────────────────────────────

export default defineCommand({
  meta: { name: "sync", description: "Sync a directory of markdown files into the brain" },
  args: {
    dir: { type: "positional", description: "Directory to sync", required: true },
    db: { type: "string", description: "Path to brain.db" },
    "git-only": {
      type: "boolean",
      description: "Git-commit mode: incremental sync via git diff, tracks deletes and renames",
      default: false,
    },
    "prune": {
      type: "boolean",
      description: "Remove brain pages whose source files no longer exist on disk (content-hash mode only)",
      default: false,
    },
    "no-embed": { type: "boolean", description: "Skip embedding generation", default: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);
    const dir = args.dir;
    const noEmbed = args["no-embed"] ?? false;
    const gitOnly = args["git-only"] ?? false;
    const prune = args["prune"] ?? false;

    // ── Git-commit mode ──────────────────────────────────────────────────────
    if (gitOnly) {
      try {
        const result = await gitIncrementalSync(engine, dir, { noEmbed });
        if (!args.json) {
          switch (result.status) {
            case "up_to_date":
              console.log(`Already up to date. (${result.toCommit.slice(0, 8)})`);
              break;
            case "first_sync":
              console.log(`\nFirst sync complete. Checkpoint: ${result.toCommit.slice(0, 8)}`);
              console.log(`  ${result.imported} imported, ${result.errors} errors`);
              break;
            case "incremental":
              console.log(`\nSynced ${result.fromCommit!.slice(0, 8)}..${result.toCommit.slice(0, 8)}`);
              console.log(`  +${result.imported} imported, ✗${result.deleted} deleted, →${result.renamed} renamed, ${result.errors} errors`);
              break;
            case "full_reimport":
              console.log(`\nFull reimport complete. Checkpoint: ${result.toCommit.slice(0, 8)}`);
              console.log(`  ${result.imported} imported, ${result.errors} errors`);
              break;
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (e) {
        console.error(`✗ ${(e as Error).message}`);
        process.exit(1);
      }
      return;
    }

    // ── Content-hash mode ────────────────────────────────────────────────────
    const files = findMarkdownFiles(dir);

    if (files.length === 0) {
      console.log("No markdown files found.");
      return;
    }

    const results = [];
    const seenSlugs = new Set<string>();

    for (const file of files) {
      const rel = relative(dir, file).replace(/\.md$/, '');
      seenSlugs.add(rel);
      const result = await importFile(engine, file, rel, { noEmbed });
      results.push(result);
      if (!args.json) {
        const icon = result.status === 'imported' ? '✓' : result.status === 'skipped' ? '·' : '✗';
        console.log(`${icon} ${result.slug}${result.error ? `  (${result.error})` : ''}`);
      }
    }

    // Orphan pruning
    let pruned = 0;
    if (prune) {
      const allPages = engine.listPages({ limit: 1_000_000 });
      for (const page of allPages) {
        if (!seenSlugs.has(page.slug)) {
          engine.deletePage(page.slug);
          pruned++;
          if (!args.json) console.log(`  ✗ ${page.slug} (pruned — no source file)`);
        }
      }
    }

    if (args.json) {
      console.log(JSON.stringify({ results, pruned }, null, 2));
    } else {
      const imported = results.filter(r => r.status === 'imported').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const errors = results.filter(r => r.status === 'error').length;
      const pruneNote = prune ? `, ${pruned} pruned` : "";
      console.log(`\nDone: ${imported} imported, ${skipped} skipped, ${errors} errors${pruneNote}`);
    }
  },
});
