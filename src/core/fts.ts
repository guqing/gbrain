import { Database } from "bun:sqlite";

export interface FtsRow {
  id: number;
  slug: string;
  title: string;
  type: string;
  score: number;
  snippet: string;
}

/**
 * Preprocess a search query for FTS5 compatibility:
 * 1. Insert spaces at CJK↔ASCII transitions (e.g. "RAG向量" → "RAG 向量")
 * 2. Strip characters that cause FTS5 parse errors (e.g. "…" U+2026)
 */
function preprocessFtsQuery(raw: string): string {
  return raw
    // Space between ASCII/digit and CJK
    .replace(/([A-Za-z0-9_])([^\x00-\x7F])/g, "$1 $2")
    // Space between CJK and ASCII/digit
    .replace(/([^\x00-\x7F])([A-Za-z0-9_])/g, "$1 $2")
    // Strip ellipsis and other common punctuation that breaks FTS5 MATCH syntax
    .replace(/[…\u2014\u2013\u201c\u201d\u2018\u2019]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * LIKE-based fallback search used when FTS5 returns no results.
 * Matches pages whose compiled_truth or title contain ALL space-split terms
 * (case-insensitive substring match). Handles Chinese compound queries that
 * FTS5's unicode61 tokenizer cannot split (e.g. "数据库设计").
 */
function likeSearch(
  db: Database,
  terms: string[],
  opts: { type?: string; limit?: number },
): FtsRow[] {
  const limit = opts.limit ?? 10;
  if (terms.length === 0) return [];

  const conditions = terms.map(() => "(compiled_truth LIKE ? OR title LIKE ?)").join(" AND ");
  const params = terms.flatMap((t) => [`%${t}%`, `%${t}%`]);

  type Row = { id: number; slug: string; title: string; type: string };
  let rows: Row[];
  try {
    rows = db
      .query<Row, string[]>(
        `SELECT id, slug, title, type FROM pages WHERE ${conditions}${opts.type ? " AND type = ?" : ""} LIMIT ${limit * 2}`,
      )
      .all(opts.type ? [...params, opts.type] : params);
  } catch {
    return [];
  }

  const results: FtsRow[] = [];
  for (const row of rows) {
    // Build a simple snippet from compiled_truth
    const ct = (db.query<{ compiled_truth: string }, [number]>(
      "SELECT compiled_truth FROM pages WHERE id = ? LIMIT 1",
    ).get(row.id)?.compiled_truth ?? "");
    const firstTerm = terms[0]!;
    const idx = ct.toLowerCase().indexOf(firstTerm.toLowerCase());
    const snippet = idx >= 0
      ? "..." + ct.slice(Math.max(0, idx - 20), idx + 80) + "..."
      : ct.slice(0, 100);

    results.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      type: row.type,
      score: 1.0, // flat score for LIKE results
      snippet,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export function ftsSearch(
  db: Database,
  query: string,
  opts: { type?: string; limit?: number } = {}
): FtsRow[] {
  const limit = opts.limit ?? 10;

  // Preprocess: fix CJK-ASCII boundaries and strip FTS5-breaking chars
  const ftsQuery = preprocessFtsQuery(query);

  let rows: { id: number; slug: string; title: string; type: string; rank: number }[] = [];
  if (ftsQuery.length > 0) {
    try {
      rows = db
        .query<
          { id: number; slug: string; title: string; type: string; rank: number },
          [string]
        >(
          `SELECT p.id, p.slug, p.title, p.type, page_fts.rank AS rank
           FROM page_fts
           JOIN pages p ON page_fts.rowid = p.id
           WHERE page_fts MATCH ?
           ORDER BY rank
           LIMIT ${limit * 3}`  // over-fetch so we can filter by type
        )
        .all(ftsQuery);
    } catch { /* FTS parse error — fall through to LIKE */ }
  }

  const snippetStmt = db.query<{ snippet: string }, [string, number]>(
    `SELECT snippet(page_fts, 1, '', '', '...', 24) AS snippet
     FROM page_fts
     WHERE page_fts MATCH ?
     AND rowid = ?`
  );

  const results: FtsRow[] = [];
  const seen = new Set<number>();

  for (const row of rows) {
    if (opts.type && row.type !== opts.type) continue;
    let snippet = "";
    try {
      snippet = snippetStmt.get(ftsQuery, row.id)?.snippet ?? "";
    } catch { /* snippet may fail on unusual queries */ }
    results.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      type: row.type,
      score: Math.abs(row.rank),
      snippet,
    });
    seen.add(row.id);
    if (results.length >= limit) break;
  }

  // LIKE fallback: if FTS returned fewer results than the limit, supplement
  // with LIKE-based matches. This handles compound Chinese terms that FTS5
  // tokenizes as a single opaque token (e.g. "数据库设计" isn't split by
  // unicode61 into "数据库" + "设计"), ensuring relevant pages are always found.
  if (results.length < limit) {
    const terms = ftsQuery.split(/\s+/).filter((t) => t.length >= 2);
    if (terms.length > 0) {
      const likeResults = likeSearch(db, terms, { ...opts, limit: limit - results.length });
      for (const r of likeResults) {
        if (!seen.has(r.id)) {
          results.push(r);
          seen.add(r.id);
        }
        if (results.length >= limit) break;
      }
    }
  }

  return results;
}
