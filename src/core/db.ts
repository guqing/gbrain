import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { buildSearchTokens } from "./fts.ts";

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT    NOT NULL UNIQUE,
  type           TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  compiled_truth TEXT    NOT NULL DEFAULT '',
  timeline       TEXT    NOT NULL DEFAULT '',
  frontmatter    TEXT    NOT NULL DEFAULT '{}',
  content_hash   TEXT,
  compiled_at    INTEGER,
  search_tokens  TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type);
CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);

-- FTS5 with search_tokens (col 3) for CJK bigram matching.
-- Columns: 0=title, 1=compiled_truth, 2=timeline, 3=search_tokens
-- snippet() should always target col 1 (compiled_truth) for human-readable output.
CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
  title,
  compiled_truth,
  timeline,
  search_tokens,
  content='pages',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline, search_tokens)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline, new.search_tokens);
END;

CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline, search_tokens)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline, old.search_tokens);
END;

CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline, search_tokens)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline, old.search_tokens);
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline, search_tokens)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline, new.search_tokens);
END;

CREATE TABLE IF NOT EXISTS page_embeddings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text  TEXT    NOT NULL,
  embedding   BLOB    NOT NULL,
  model       TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_embeddings_page ON page_embeddings(page_id);

CREATE TABLE IF NOT EXISTS content_chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text  TEXT    NOT NULL,
  chunk_source TEXT   NOT NULL DEFAULT 'compiled_truth',
  embedding   BLOB,
  model       TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
  token_count INTEGER,
  embedded_at TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_page ON content_chunks(page_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_page_chunk ON content_chunks(page_id, chunk_index);

CREATE TABLE IF NOT EXISTS links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_page_id   INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  context      TEXT    NOT NULL DEFAULT '',
  link_type    TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(from_page_id, to_page_id)
);

CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_page_id);
CREATE INDEX IF NOT EXISTS idx_links_to   ON links(to_page_id);

CREATE TABLE IF NOT EXISTS tags (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  UNIQUE(page_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag     ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_tags_page_id ON tags(page_id);

CREATE TABLE IF NOT EXISTS timeline_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  entry_date TEXT    NOT NULL,
  source     TEXT    NOT NULL DEFAULT '',
  summary    TEXT    NOT NULL,
  detail     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_timeline_page ON timeline_entries(page_id);
CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline_entries(entry_date);

CREATE TABLE IF NOT EXISTS page_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id      INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  compiled_truth TEXT  NOT NULL,
  frontmatter  TEXT    NOT NULL DEFAULT '{}',
  snapshot_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_versions_page ON page_versions(page_id);

CREATE TABLE IF NOT EXISTS raw_data (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id   INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  source    TEXT    NOT NULL,
  data      TEXT    NOT NULL,
  fetched_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(page_id, source)
);

CREATE TABLE IF NOT EXISTS staleness_checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  checked_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  outcome    TEXT    NOT NULL,
  notes      TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ingest_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT NOT NULL,
  source_ref    TEXT NOT NULL,
  pages_updated TEXT NOT NULL DEFAULT '[]',
  summary       TEXT NOT NULL DEFAULT '',
  timestamp     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO config (key, value) VALUES
  ('version', '2'),
  ('embedding_model', 'text-embedding-3-small'),
  ('chunk_strategy', 'recursive');

CREATE TABLE IF NOT EXISTS brain_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── Files (v0.5) ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS files (
  slug          TEXT    PRIMARY KEY,
  sha256        TEXT    NOT NULL,
  file_path     TEXT    NOT NULL,
  original_name TEXT,
  mime_type     TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  description   TEXT,
  processed_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);

CREATE TABLE IF NOT EXISTS page_files (
  page_slug     TEXT    NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  file_slug     TEXT    NOT NULL REFERENCES files(slug) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (page_slug, file_slug)
);

CREATE INDEX IF NOT EXISTS idx_page_files_page ON page_files(page_slug);
CREATE INDEX IF NOT EXISTS idx_page_files_file ON page_files(file_slug);

CREATE TABLE IF NOT EXISTS file_references (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  page_slug      TEXT    NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  file_slug      TEXT    NOT NULL REFERENCES files(slug) ON DELETE CASCADE,
  source_type    TEXT    NOT NULL,
  source_ref     TEXT    NOT NULL,
  source_item_id TEXT    NOT NULL DEFAULT '',
  source_role    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(page_slug, file_slug, source_type, source_ref, source_item_id)
);

CREATE INDEX IF NOT EXISTS idx_file_references_page   ON file_references(page_slug);
CREATE INDEX IF NOT EXISTS idx_file_references_file   ON file_references(file_slug);
CREATE INDEX IF NOT EXISTS idx_file_references_source ON file_references(source_type, source_ref);

CREATE TABLE IF NOT EXISTS file_chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_slug    TEXT    NOT NULL REFERENCES files(slug) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL DEFAULT 0,
  chunk_text   TEXT    NOT NULL,
  chunk_source TEXT    NOT NULL DEFAULT 'description',
  embedding    BLOB,
  model        TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
  embedded_at  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(file_slug, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_file_chunks_file ON file_chunks(file_slug);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_files USING fts5(
  description,
  content='files',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files
WHEN new.description IS NOT NULL
BEGIN
  INSERT INTO fts_files(rowid, description) VALUES (new.rowid, new.description);
END;

CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF description ON files
WHEN new.description IS NOT NULL AND old.description IS NOT NULL
BEGIN
  INSERT INTO fts_files(fts_files, rowid, description)
    VALUES('delete', old.rowid, old.description);
  INSERT INTO fts_files(rowid, description) VALUES (new.rowid, new.description);
END;

CREATE TRIGGER IF NOT EXISTS files_au_insert AFTER UPDATE OF description ON files
WHEN new.description IS NOT NULL AND old.description IS NULL
BEGIN
  INSERT INTO fts_files(rowid, description) VALUES (new.rowid, new.description);
END;

CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files
WHEN old.description IS NOT NULL
BEGIN
  INSERT INTO fts_files(fts_files, rowid, description)
    VALUES('delete', old.rowid, old.description);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS fts_file_chunks USING fts5(
  chunk_text,
  content='file_chunks',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS file_chunks_ai AFTER INSERT ON file_chunks
BEGIN
  INSERT INTO fts_file_chunks(rowid, chunk_text) VALUES (new.id, new.chunk_text);
END;

CREATE TRIGGER IF NOT EXISTS file_chunks_au AFTER UPDATE OF chunk_text ON file_chunks
BEGIN
  INSERT INTO fts_file_chunks(fts_file_chunks, rowid, chunk_text)
    VALUES('delete', old.id, old.chunk_text);
  INSERT INTO fts_file_chunks(rowid, chunk_text) VALUES (new.id, new.chunk_text);
END;

CREATE TRIGGER IF NOT EXISTS file_chunks_ad AFTER DELETE ON file_chunks
BEGIN
  INSERT INTO fts_file_chunks(fts_file_chunks, rowid, chunk_text)
    VALUES('delete', old.id, old.chunk_text);
END;

-- ── Import Runs (v0.5) ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type     TEXT    NOT NULL,
  source_ref      TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'running',
  total_items     INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items    INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  finished_at     TEXT,
  summary         TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_import_runs_source ON import_runs(source_type, source_ref);
CREATE INDEX IF NOT EXISTS idx_import_runs_status ON import_runs(status, started_at);

CREATE TABLE IF NOT EXISTS import_run_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  import_run_id INTEGER NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  item_key      TEXT    NOT NULL,
  item_type     TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending',
  page_slug     TEXT,
  error_code    TEXT,
  error_message TEXT,
  retryable     INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(import_run_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_import_run_items_run ON import_run_items(import_run_id, status);

CREATE TABLE IF NOT EXISTS import_checkpoints (
  source_type  TEXT    NOT NULL,
  source_ref   TEXT    NOT NULL,
  item_key     TEXT    NOT NULL,
  item_type    TEXT    NOT NULL,
  status       TEXT    NOT NULL,
  page_slug    TEXT,
  last_run_id  INTEGER REFERENCES import_runs(id) ON DELETE SET NULL,
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (source_type, source_ref, item_key)
);

CREATE INDEX IF NOT EXISTS idx_import_checkpoints_run    ON import_checkpoints(last_run_id);
CREATE INDEX IF NOT EXISTS idx_import_checkpoints_source ON import_checkpoints(source_type, source_ref, status);
`;

export function resolveDbPath(flagPath?: string): string {
  if (flagPath) return flagPath;
  if (process.env["EXO_DB"]) return process.env["EXO_DB"];
  // Default: ~/.exo/brain.db (same dir as config.toml)
  return join(homedir(), ".exo", "brain.db");
}

export function migrateDb(db: Database): void {
  // Add content_hash to pages if missing
  const pagesInfo = db.query<{ name: string }, []>("PRAGMA table_info(pages)").all();
  const pagesColumns = new Set(pagesInfo.map(r => r.name));
  if (!pagesColumns.has('content_hash')) {
    db.exec("ALTER TABLE pages ADD COLUMN content_hash TEXT");
  }
  if (!pagesColumns.has('compiled_at')) {
    db.exec("ALTER TABLE pages ADD COLUMN compiled_at INTEGER");
  }

  // Migration: add search_tokens column + rebuild page_fts with the new column.
  // search_tokens stores pre-expanded CJK bigrams so that 2-character compounds
  // like "提交"/"邮箱" can be found by FTS5 (unicode61 alone cannot split CJK).
  if (!pagesColumns.has('search_tokens')) {
    db.exec("ALTER TABLE pages ADD COLUMN search_tokens TEXT NOT NULL DEFAULT ''");

    // Rebuild page_fts to include the new search_tokens column.
    // We must drop the old virtual table and its triggers, then recreate them.
    db.exec(`
      DROP TRIGGER IF EXISTS pages_au;
      DROP TRIGGER IF EXISTS pages_ad;
      DROP TRIGGER IF EXISTS pages_ai;
      DROP TABLE IF EXISTS page_fts;

      CREATE VIRTUAL TABLE page_fts USING fts5(
        title,
        compiled_truth,
        timeline,
        search_tokens,
        content='pages',
        content_rowid='id',
        tokenize='porter unicode61'
      );

      CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
        INSERT INTO page_fts(rowid, title, compiled_truth, timeline, search_tokens)
        VALUES (new.id, new.title, new.compiled_truth, new.timeline, new.search_tokens);
      END;

      CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
        INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline, search_tokens)
        VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline, old.search_tokens);
      END;

      CREATE TRIGGER pages_au AFTER UPDATE ON pages BEGIN
        INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline, search_tokens)
        VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline, old.search_tokens);
        INSERT INTO page_fts(rowid, title, compiled_truth, timeline, search_tokens)
        VALUES (new.id, new.title, new.compiled_truth, new.timeline, new.search_tokens);
      END;
    `);

    // Backfill search_tokens for every existing row using CJK bigram expansion.
    type PageRow = { id: number; title: string; compiled_truth: string; timeline: string };
    const pages = db.query<PageRow, []>(
      "SELECT id, title, compiled_truth, timeline FROM pages"
    ).all();
    const updateStmt = db.prepare(
      "UPDATE pages SET search_tokens = ? WHERE id = ?"
    );
    for (const p of pages) {
      const raw = [p.title, p.compiled_truth, p.timeline].join(" ");
      updateStmt.run(buildSearchTokens(raw), p.id);
    }

    // Rebuild FTS index from the now-populated search_tokens column.
    db.exec(`INSERT INTO page_fts(page_fts) VALUES('rebuild')`);
  } else {
    // Secondary guard: if the column exists but all rows are empty, the backfill
    // failed (e.g., old binary ran the migration before buildSearchTokens existed).
    // Re-run the backfill automatically.
    const emptyCount = db.query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM pages WHERE length(search_tokens) = 0"
    ).get()!.n;
    const totalCount = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM pages").get()!.n;
    if (totalCount > 0 && emptyCount === totalCount) {
      type PageRow2 = { id: number; title: string; compiled_truth: string; timeline: string };
      const allPages = db.query<PageRow2, []>(
        "SELECT id, title, compiled_truth, timeline FROM pages"
      ).all();

      // Drop triggers first so UPDATE pages doesn't fire into a potentially
      // corrupted or empty page_fts table.
      db.exec(`
        DROP TRIGGER IF EXISTS pages_au;
        DROP TRIGGER IF EXISTS pages_ad;
        DROP TRIGGER IF EXISTS pages_ai;
        DROP TABLE IF EXISTS page_fts;

        CREATE VIRTUAL TABLE page_fts USING fts5(
          title,
          compiled_truth,
          timeline,
          search_tokens,
          content='pages',
          content_rowid='id',
          tokenize='porter unicode61'
        );
      `);

      const refill = db.prepare("UPDATE pages SET search_tokens = ? WHERE id = ?");
      for (const p of allPages) {
        const raw = [p.title, p.compiled_truth, p.timeline].join(" ");
        refill.run(buildSearchTokens(raw), p.id);
      }

      // Rebuild FTS from the content table now that search_tokens is populated.
      db.exec(`INSERT INTO page_fts(page_fts) VALUES('rebuild')`);

      // Recreate triggers for ongoing maintenance.
      db.exec(`
        CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
          INSERT INTO page_fts(rowid, title, compiled_truth, timeline, search_tokens)
          VALUES (new.id, new.title, new.compiled_truth, new.timeline, new.search_tokens);
        END;

        CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
          INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline, search_tokens)
          VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline, old.search_tokens);
        END;

        CREATE TRIGGER pages_au AFTER UPDATE ON pages BEGIN
          INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline, search_tokens)
          VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline, old.search_tokens);
          INSERT INTO page_fts(rowid, title, compiled_truth, timeline, search_tokens)
          VALUES (new.id, new.title, new.compiled_truth, new.timeline, new.search_tokens);
        END;
      `);
    }
  }

  // Add link_type to links if missing
  const linksInfo = db.query<{ name: string }, []>("PRAGMA table_info(links)").all();
  const linksColumns = new Set(linksInfo.map(r => r.name));
  if (!linksColumns.has('link_type')) {
    db.exec("ALTER TABLE links ADD COLUMN link_type TEXT NOT NULL DEFAULT ''");
  }

  // Create new tables if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      chunk_text  TEXT    NOT NULL,
      chunk_source TEXT   NOT NULL DEFAULT 'compiled_truth',
      embedding   BLOB,
      model       TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
      token_count INTEGER,
      embedded_at TEXT,
      created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_page ON content_chunks(page_id);

    CREATE TABLE IF NOT EXISTS timeline_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      entry_date TEXT    NOT NULL,
      source     TEXT    NOT NULL DEFAULT '',
      summary    TEXT    NOT NULL,
      detail     TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_page ON timeline_entries(page_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline_entries(entry_date);

    CREATE TABLE IF NOT EXISTS page_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id      INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      compiled_truth TEXT  NOT NULL,
      frontmatter  TEXT    NOT NULL DEFAULT '{}',
      snapshot_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_versions_page ON page_versions(page_id);

    CREATE TABLE IF NOT EXISTS raw_data (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id   INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      source    TEXT    NOT NULL,
      data      TEXT    NOT NULL,
      fetched_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(page_id, source)
    );

    CREATE TABLE IF NOT EXISTS ingest_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type   TEXT NOT NULL,
      source_ref    TEXT NOT NULL,
      pages_updated TEXT NOT NULL DEFAULT '[]',
      summary       TEXT NOT NULL DEFAULT '',
      timestamp     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brain_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Add UNIQUE INDEX on content_chunks(page_id, chunk_index) for safe UPSERT.
  // Without this, INSERT OR REPLACE falls back to INSERT (no dedup guarantee).
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_page_chunk
    ON content_chunks(page_id, chunk_index);
  `);

  const contentChunksInfo = db.query<{ name: string }, []>("PRAGMA table_info(content_chunks)").all();
  const contentChunksColumns = new Set(contentChunksInfo.map(r => r.name));
  if (contentChunksInfo.length > 0 && !contentChunksColumns.has("chunk_source")) {
    db.exec("ALTER TABLE content_chunks ADD COLUMN chunk_source TEXT NOT NULL DEFAULT 'compiled_truth'");
  }

  // Add config/brain_meta if missing (older DBs)
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brain_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.exec(`INSERT OR IGNORE INTO config (key, value) VALUES
    ('version', '2'),
    ('embedding_model', 'text-embedding-3-small'),
    ('chunk_strategy', 'recursive');`);

  // v0.5: files, page_files, file_references, file_chunks, fts_files, import tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      slug          TEXT    PRIMARY KEY,
      sha256        TEXT    NOT NULL,
      file_path     TEXT    NOT NULL,
      original_name TEXT,
      mime_type     TEXT    NOT NULL,
      size_bytes    INTEGER NOT NULL,
      description   TEXT,
      processed_at  TEXT,
      created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);

    CREATE TABLE IF NOT EXISTS page_files (
      page_slug     TEXT    NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
      file_slug     TEXT    NOT NULL REFERENCES files(slug) ON DELETE CASCADE,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      PRIMARY KEY (page_slug, file_slug)
    );
    CREATE INDEX IF NOT EXISTS idx_page_files_page ON page_files(page_slug);
    CREATE INDEX IF NOT EXISTS idx_page_files_file ON page_files(file_slug);

    CREATE TABLE IF NOT EXISTS file_references (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      page_slug      TEXT    NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
      file_slug      TEXT    NOT NULL REFERENCES files(slug) ON DELETE CASCADE,
      source_type    TEXT    NOT NULL,
      source_ref     TEXT    NOT NULL,
      source_item_id TEXT    NOT NULL DEFAULT '',
      source_role    TEXT,
      created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(page_slug, file_slug, source_type, source_ref, source_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_file_references_page   ON file_references(page_slug);
    CREATE INDEX IF NOT EXISTS idx_file_references_file   ON file_references(file_slug);
    CREATE INDEX IF NOT EXISTS idx_file_references_source ON file_references(source_type, source_ref);

    CREATE TABLE IF NOT EXISTS file_chunks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      file_slug    TEXT    NOT NULL REFERENCES files(slug) ON DELETE CASCADE,
      chunk_index  INTEGER NOT NULL DEFAULT 0,
      chunk_text   TEXT    NOT NULL,
      chunk_source TEXT    NOT NULL DEFAULT 'description',
      embedding    BLOB,
      model        TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
      embedded_at  TEXT,
      created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(file_slug, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_file_chunks_file ON file_chunks(file_slug);

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_files USING fts5(
      description,
      content='files',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files
    WHEN new.description IS NOT NULL
    BEGIN
      INSERT INTO fts_files(rowid, description) VALUES (new.rowid, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF description ON files
    WHEN new.description IS NOT NULL AND old.description IS NOT NULL
    BEGIN
      INSERT INTO fts_files(fts_files, rowid, description)
        VALUES('delete', old.rowid, old.description);
      INSERT INTO fts_files(rowid, description) VALUES (new.rowid, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS files_au_insert AFTER UPDATE OF description ON files
    WHEN new.description IS NOT NULL AND old.description IS NULL
    BEGIN
      INSERT INTO fts_files(rowid, description) VALUES (new.rowid, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files
    WHEN old.description IS NOT NULL
    BEGIN
      INSERT INTO fts_files(fts_files, rowid, description)
        VALUES('delete', old.rowid, old.description);
    END;

    CREATE TABLE IF NOT EXISTS import_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type     TEXT    NOT NULL,
      source_ref      TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'running',
      total_items     INTEGER NOT NULL DEFAULT 0,
      completed_items INTEGER NOT NULL DEFAULT 0,
      failed_items    INTEGER NOT NULL DEFAULT 0,
      started_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      finished_at     TEXT,
      summary         TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_import_runs_source ON import_runs(source_type, source_ref);
    CREATE INDEX IF NOT EXISTS idx_import_runs_status ON import_runs(status, started_at);

    CREATE TABLE IF NOT EXISTS import_run_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      import_run_id INTEGER NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
      item_key      TEXT    NOT NULL,
      item_type     TEXT    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'pending',
      page_slug     TEXT,
      error_code    TEXT,
      error_message TEXT,
      retryable     INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(import_run_id, item_key)
    );
    CREATE INDEX IF NOT EXISTS idx_import_run_items_run ON import_run_items(import_run_id, status);

    CREATE TABLE IF NOT EXISTS import_checkpoints (
      source_type  TEXT    NOT NULL,
      source_ref   TEXT    NOT NULL,
      item_key     TEXT    NOT NULL,
      item_type    TEXT    NOT NULL,
      status       TEXT    NOT NULL,
      page_slug    TEXT,
      last_run_id  INTEGER REFERENCES import_runs(id) ON DELETE SET NULL,
      updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      PRIMARY KEY (source_type, source_ref, item_key)
    );
    CREATE INDEX IF NOT EXISTS idx_import_checkpoints_run    ON import_checkpoints(last_run_id);
    CREATE INDEX IF NOT EXISTS idx_import_checkpoints_source ON import_checkpoints(source_type, source_ref, status);

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_file_chunks USING fts5(
      chunk_text,
      content='file_chunks',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS file_chunks_ai AFTER INSERT ON file_chunks
    BEGIN
      INSERT INTO fts_file_chunks(rowid, chunk_text) VALUES (new.id, new.chunk_text);
    END;

    CREATE TRIGGER IF NOT EXISTS file_chunks_au AFTER UPDATE OF chunk_text ON file_chunks
    BEGIN
      INSERT INTO fts_file_chunks(fts_file_chunks, rowid, chunk_text)
        VALUES('delete', old.id, old.chunk_text);
      INSERT INTO fts_file_chunks(rowid, chunk_text) VALUES (new.id, new.chunk_text);
    END;

    CREATE TRIGGER IF NOT EXISTS file_chunks_ad AFTER DELETE ON file_chunks
    BEGIN
      INSERT INTO fts_file_chunks(fts_file_chunks, rowid, chunk_text)
        VALUES('delete', old.id, old.chunk_text);
    END;
  `);

  // Rebuild FTS indexes from any existing rows.
  // INSERT('rebuild') is idempotent and fast; harmless on fresh DBs.
  db.exec(`INSERT INTO fts_files(fts_files) VALUES('rebuild')`);
  db.exec(`INSERT INTO fts_file_chunks(fts_file_chunks) VALUES('rebuild')`);

  const fileChunksInfo = db.query<{ name: string }, []>("PRAGMA table_info(file_chunks)").all();
  const fileChunksColumns = new Set(fileChunksInfo.map(r => r.name));
  if (fileChunksInfo.length > 0 && !fileChunksColumns.has("chunk_source")) {
    db.exec("ALTER TABLE file_chunks ADD COLUMN chunk_source TEXT NOT NULL DEFAULT 'description'");
  }
}

export function openDb(dbPath: string): Database {
  if (!existsSync(dbPath)) {
    console.error(
      `✗ brain.db not found at ${dbPath}\n  Run 'exo init' first.`
    );
    process.exit(1);
  }
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrateDb(db);
  return db;
}

export function createDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  return db;
}
