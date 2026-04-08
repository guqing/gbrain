import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type);
CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);

CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
  title,
  compiled_truth,
  timeline,
  content='pages',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline);
END;

CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline);
END;

CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline);
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline);
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
`;

export function resolveDbPath(flagPath?: string): string {
  if (flagPath) return flagPath;
  if (process.env["GBRAIN_DB"]) return process.env["GBRAIN_DB"];
  // Default: ~/.gbrain/brain.db (same dir as config.toml)
  return join(homedir(), ".gbrain", "brain.db");
}

export function migrateDb(db: Database): void {
  // Add content_hash to pages if missing
  const pagesInfo = db.query<{ name: string }, []>("PRAGMA table_info(pages)").all();
  const pagesColumns = new Set(pagesInfo.map(r => r.name));
  if (!pagesColumns.has('content_hash')) {
    db.exec("ALTER TABLE pages ADD COLUMN content_hash TEXT");
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
  `);

  db.exec(`INSERT OR IGNORE INTO config (key, value) VALUES
    ('version', '2'),
    ('embedding_model', 'text-embedding-3-small'),
    ('chunk_strategy', 'recursive');`);
}

export function openDb(dbPath: string): Database {
  if (!existsSync(dbPath)) {
    console.error(
      `✗ brain.db not found at ${dbPath}\n  Run 'gbrain init' first.`
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
