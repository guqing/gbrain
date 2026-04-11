import { defineCommand } from "citty";
import { resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { loadConfig } from "../core/config.ts";

type CheckStatus = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

function runChecks(dbPath: string): Check[] {
  const checks: Check[] = [];

  // ── 1. Connection ──────────────────────────────────────────────────────────
  if (!existsSync(dbPath)) {
    checks.push({
      name: 'connection',
      status: 'fail',
      message: `brain.db not found at ${dbPath}`,
      fix: "Run: gbrain init",
    });
    return checks; // All other checks depend on DB existing
  }

  let db: Database;
  let engine: SqliteEngine;
  try {
    db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    engine = new SqliteEngine(db);
    engine.initSchema();
    checks.push({ name: 'connection', status: 'ok', message: `Connected to ${dbPath}` });
  } catch (e) {
    checks.push({
      name: 'connection',
      status: 'fail',
      message: `Cannot open brain.db: ${e instanceof Error ? e.message : String(e)}`,
      fix: "Run: gbrain init --force  (or check file permissions)",
    });
    return checks;
  }

  // ── 2. FTS5 index integrity ────────────────────────────────────────────────
  try {
    const pageCount = (db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM pages").get())?.n ?? 0;
    const ftsCount = (db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM page_fts").get())?.n ?? 0;
    if (pageCount === 0) {
      checks.push({ name: 'fts_index', status: 'ok', message: 'No pages yet — FTS index empty' });
    } else if (Math.abs(pageCount - ftsCount) > pageCount * 0.05) {
      checks.push({
        name: 'fts_index',
        status: 'warn',
        message: `FTS index may be stale: ${pageCount} pages, ${ftsCount} FTS rows`,
        fix: "Run: gbrain init --rebuild-fts  (or recreate DB from export)",
      });
    } else {
      checks.push({ name: 'fts_index', status: 'ok', message: `${pageCount} pages, FTS index consistent` });
    }
  } catch (e) {
    checks.push({ name: 'fts_index', status: 'warn', message: `FTS check failed: ${e instanceof Error ? e.message : String(e)}` });
  }

  // ── 3. Embedding coverage ──────────────────────────────────────────────────
  try {
    const pageCount = (db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM pages").get())?.n ?? 0;
    const embeddedPages = (db.query<{ n: number }, []>(
      "SELECT COUNT(DISTINCT page_id) as n FROM content_chunks WHERE embedding IS NOT NULL"
    ).get())?.n ?? 0;

    if (pageCount === 0) {
      checks.push({ name: 'embedding_coverage', status: 'ok', message: 'No pages yet' });
    } else {
      const pct = Math.round((embeddedPages / pageCount) * 100);
      if (pct < 50) {
        checks.push({
          name: 'embedding_coverage',
          status: 'warn',
          message: `Low embedding coverage: ${pct}% (${embeddedPages}/${pageCount} pages)`,
          fix: "Run: gbrain embed --all",
        });
      } else {
        checks.push({ name: 'embedding_coverage', status: 'ok', message: `${pct}% coverage (${embeddedPages}/${pageCount} pages)` });
      }
    }
  } catch (e) {
    checks.push({ name: 'embedding_coverage', status: 'warn', message: `Coverage check failed: ${e instanceof Error ? e.message : String(e)}` });
  }

  // ── 4. Orphaned chunks ─────────────────────────────────────────────────────
  try {
    const orphans = (db.query<{ n: number }, []>(
      "SELECT COUNT(*) as n FROM content_chunks WHERE page_id NOT IN (SELECT id FROM pages)"
    ).get())?.n ?? 0;
    if (orphans > 0) {
      checks.push({
        name: 'orphan_chunks',
        status: 'warn',
        message: `${orphans} orphaned chunk rows (no parent page)`,
        fix: "Run: gbrain health --prune",
      });
    } else {
      checks.push({ name: 'orphan_chunks', status: 'ok', message: 'No orphaned chunks' });
    }
  } catch (e) {
    checks.push({ name: 'orphan_chunks', status: 'warn', message: `Orphan check failed: ${e instanceof Error ? e.message : String(e)}` });
  }

  // ── 5. Schema version ─────────────────────────────────────────────────────
  try {
    const schemaVersion = db.query<{ value: string }, [string]>(
      "SELECT value FROM config WHERE key = ?"
    ).get('version')?.value;
    if (schemaVersion === '2') {
      checks.push({ name: 'schema_version', status: 'ok', message: `Schema version: ${schemaVersion}` });
    } else {
      checks.push({
        name: 'schema_version',
        status: 'warn',
        message: `Schema version ${schemaVersion ?? 'unknown'} (expected 2)`,
        fix: "Run: gbrain init  (to re-run migrations)",
      });
    }
  } catch {
    checks.push({ name: 'schema_version', status: 'warn', message: 'Cannot read schema version from config' });
  }

  // ── 6. Config: embed API key ───────────────────────────────────────────────
  try {
    const cfg = loadConfig();
    const hasEmbedKey = !!(cfg.embed?.api_key ?? process.env['OPENAI_API_KEY']);
    checks.push({
      name: 'embed_config',
      status: hasEmbedKey ? 'ok' : 'warn',
      message: hasEmbedKey ? 'Embed API key configured' : 'No embed API key — semantic search unavailable',
      fix: hasEmbedKey ? undefined : "Run: gbrain config set embed.api_key <key>",
    });
  } catch {
    checks.push({ name: 'embed_config', status: 'warn', message: 'Cannot read config file' });
  }

  // ── 7. Config: compile API key ────────────────────────────────────────────
  try {
    const cfg = loadConfig();
    const hasCompileKey = !!(cfg.compile?.api_key ?? process.env['OPENAI_API_KEY'] ?? process.env['ANTHROPIC_API_KEY']);
    checks.push({
      name: 'compile_config',
      status: hasCompileKey ? 'ok' : 'warn',
      message: hasCompileKey ? 'Compile API key configured' : 'No compile API key — gbrain compile will fail',
      fix: hasCompileKey ? undefined : "Run: gbrain config set compile.api_key <key>",
    });
  } catch {
    checks.push({ name: 'compile_config', status: 'warn', message: 'Cannot read compile config' });
  }

  // ── 8. Inbox backlog ──────────────────────────────────────────────────────
  try {
    const inboxCount = (db.query<{ n: number }, []>(
      "SELECT COUNT(*) as n FROM pages WHERE type = 'inbox'"
    ).get())?.n ?? 0;
    if (inboxCount === 0) {
      checks.push({ name: 'inbox_backlog', status: 'ok', message: 'Inbox empty' });
    } else if (inboxCount > 20) {
      checks.push({
        name: 'inbox_backlog',
        status: 'warn',
        message: `Inbox backlog: ${inboxCount} items pending`,
        fix: "Run: gbrain compile",
      });
    } else {
      checks.push({ name: 'inbox_backlog', status: 'ok', message: `Inbox: ${inboxCount} items queued` });
    }
  } catch (e) {
    checks.push({ name: 'inbox_backlog', status: 'warn', message: `Inbox check failed: ${e instanceof Error ? e.message : String(e)}` });
  }

  db.close();
  return checks;
}

export function runDoctor(dbPath: string) {
  return runChecks(dbPath);
}

export default defineCommand({
  meta: { name: "doctor", description: "Run health checks on the brain database and configuration" },
  args: {
    db:   { type: "string",  description: "Path to brain.db" },
    json: { type: "boolean", description: "Output JSON (machine-readable)", default: false },
  },
  run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const checks = runChecks(dbPath);

    if (args.json) {
      const hasFail = checks.some(c => c.status === 'fail');
      console.log(JSON.stringify({ healthy: !hasFail, checks }, null, 2));
      if (hasFail) process.exit(1);
      return;
    }

    console.log("gbrain doctor\n");
    for (const c of checks) {
      const icon = c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
      console.log(`  ${icon}  ${c.name}: ${c.message}`);
      if (c.fix) console.log(`       ${c.fix}`);
    }

    const fails = checks.filter(c => c.status === 'fail');
    const warns = checks.filter(c => c.status === 'warn');
    const oks   = checks.filter(c => c.status === 'ok');

    console.log(`\n  ${oks.length} ok · ${warns.length} warnings · ${fails.length} failures`);

    if (fails.length > 0) {
      console.log("\n  Fix the failures above before using gbrain.");
      process.exit(1);
    } else if (warns.length > 0) {
      console.log("\n  Warnings are non-blocking but worth addressing.");
    } else {
      console.log("\n  Brain is healthy.");
    }
  },
});
