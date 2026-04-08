import { Database } from "bun:sqlite";

export interface FtsRow {
  id: number;
  slug: string;
  title: string;
  type: string;
  score: number;
  snippet: string;
}

export function ftsSearch(
  db: Database,
  query: string,
  opts: { type?: string; limit?: number } = {}
): FtsRow[] {
  const limit = opts.limit ?? 10;

  const rows = db
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
    .all(query);

  const snippetStmt = db.query<{ snippet: string }, [string, number]>(
    `SELECT snippet(page_fts, 1, '…', '…', '...', 12) AS snippet
     FROM page_fts
     WHERE page_fts MATCH ?
     AND rowid = ?`
  );

  const results: FtsRow[] = [];
  for (const row of rows) {
    if (opts.type && row.type !== opts.type) continue;
    const snip = snippetStmt.get(query, row.id);
    results.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      type: row.type,
      score: Math.abs(row.rank),
      snippet: snip?.snippet ?? "",
    });
    if (results.length >= limit) break;
  }

  return results;
}
