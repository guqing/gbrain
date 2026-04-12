/**
 * Query result cache for hybrid search.
 * Caches (expanded query + embedding) keyed by the original query text.
 * Eliminates repeated LLM expansion + embed API calls for the same query.
 * TTL: 7 days.
 */
import type { Database } from "bun:sqlite";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashQuery(query: string): string {
  // Simple djb2-style hash — good enough for a local cache key
  let h = 5381;
  for (let i = 0; i < query.length; i++) {
    h = ((h << 5) + h) ^ query.charCodeAt(i);
    h >>>= 0;
  }
  return h.toString(36).padStart(7, "0");
}

export interface CachedQuery {
  expanded: string;
  embedding: Float32Array | null;
}

export function getCachedQuery(db: Database, query: string): CachedQuery | null {
  const key = hashQuery(query.toLowerCase().trim());
  const row = db.query<
    { expanded: string; embedding: Buffer | null; created_at: number; query: string },
    [string]
  >("SELECT expanded, embedding, created_at, query FROM query_cache WHERE hash = ?").get(key);

  if (!row) return null;
  // Guard against hash collision: verify the stored query matches
  if (row.query !== query) return null;
  if (Date.now() - row.created_at > TTL_MS) {
    db.run("DELETE FROM query_cache WHERE hash = ?", [key]);
    return null;
  }

  db.run("UPDATE query_cache SET hit_count = hit_count + 1 WHERE hash = ?", [key]);

  const embedding = row.embedding
    ? new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      )
    : null;

  return { expanded: row.expanded, embedding };
}

export function setCachedQuery(
  db: Database,
  query: string,
  expanded: string,
  embedding: Float32Array | null,
): void {
  const key = hashQuery(query.toLowerCase().trim());
  const embBlob = embedding ? Buffer.from(embedding.buffer) : null;
  db.run(
    `INSERT OR REPLACE INTO query_cache (hash, query, expanded, embedding, created_at, hit_count)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [key, query, expanded, embBlob, Date.now()],
  );
}

export function ensureQueryCacheTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS query_cache (
      hash        TEXT PRIMARY KEY,
      query       TEXT NOT NULL,
      expanded    TEXT NOT NULL,
      embedding   BLOB,
      created_at  INTEGER NOT NULL,
      hit_count   INTEGER DEFAULT 0
    )
  `);
}
