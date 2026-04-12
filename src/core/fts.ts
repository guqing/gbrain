import { Database } from "bun:sqlite";

export interface FtsRow {
  id: number;
  slug: string;
  title: string;
  type: string;
  score: number;
  snippet: string;
}

/** Returns true for CJK Unified Ideographs (BMP + Extension B). */
function isCJK(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||  // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) ||  // CJK Extension A
    (cp >= 0x20000 && cp <= 0x2a6df)   // CJK Extension B (surrogate pair range)
  );
}

/**
 * Expand CJK runs into overlapping unigrams + bigrams + trigrams so that
 * FTS5's unicode61 tokenizer can index and match any sub-compound.
 *
 * "提交邮箱" → "提 提交 提交邮 交 交邮 交邮箱 邮 邮箱 箱"
 *
 * Non-CJK text is kept as-is (porter stemmer handles English).
 * Duplicate tokens are deduplicated before joining.
 *
 * Used both at **index time** (stored in pages.search_tokens) and at
 * **query time** (applied to FTS5 MATCH queries) so the token vocabulary
 * aligns perfectly.
 */
export function buildSearchTokens(text: string): string {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    const cp = text.codePointAt(i)!;

    if (isCJK(cp)) {
      // Collect contiguous CJK run
      let run = "";
      while (i < text.length && isCJK(text.codePointAt(i)!)) {
        run += text[i++];
      }
      // Emit unigram, bigram, trigram at each position
      for (let j = 0; j < run.length; j++) {
        tokens.push(run[j]!);
        if (j + 1 < run.length) tokens.push(run.slice(j, j + 2));
        if (j + 2 < run.length) tokens.push(run.slice(j, j + 3));
      }
    } else if (cp <= 32 || cp === 0x3000) {
      // Whitespace / ideographic space — skip
      i++;
    } else {
      // Non-CJK word (ASCII, Katakana, etc.) — collect until CJK or whitespace
      let word = "";
      while (i < text.length) {
        const c = text.codePointAt(i)!;
        if (isCJK(c) || c <= 32 || c === 0x3000) break;
        word += text[i++];
      }
      if (word) tokens.push(word);
    }
  }

  // Deduplicate while preserving order, then join
  return [...new Set(tokens)].join(" ");
}

/**
 * Preprocess a search query for FTS5:
 * - CJK characters: emit ONLY unigrams (single chars). This avoids cross-boundary
 *   bigrams that exist in the query but not in any document, which would cause
 *   FTS5's implicit AND to return zero results. The bigram index on documents
 *   ensures precision; unigrams in queries maximize recall.
 * - ASCII/Latin words: kept as-is (porter stemmer handles them).
 *
 * Example: "git 提交邮箱修改" → "git 提 交 邮 箱 修 改"
 */
function preprocessFtsQuery(raw: string): string {
  const tokens: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const cp = raw.codePointAt(i)!;
    if (isCJK(cp)) {
      // Single CJK character as unigram — do NOT generate bigrams for queries
      tokens.push(raw[i]);
      i++;
    } else if (cp <= 32 || cp === 0x3000) {
      i++;
    } else {
      let word = "";
      while (i < raw.length) {
        const c = raw.codePointAt(i)!;
        if (isCJK(c) || c <= 32 || c === 0x3000) break;
        word += raw[i++];
      }
      if (word) tokens.push(word);
    }
  }
  const deduped = [...new Set(tokens)].join(" ");
  return deduped
    .replace(/[…\u2014\u2013\u201c\u201d\u2018\u2019]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * LIKE-based fallback: matches pages whose content contains ALL original query
 * terms as substrings. Used only when FTS5 returns fewer results than limit.
 *
 * NOTE: terms here must be the ORIGINAL query words, not bigram-expanded tokens.
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
    const ct = (db.query<{ compiled_truth: string }, [number]>(
      "SELECT compiled_truth FROM pages WHERE id = ? LIMIT 1",
    ).get(row.id)?.compiled_truth ?? "");
    const firstTerm = terms[0]!;
    const idx = ct.toLowerCase().indexOf(firstTerm.toLowerCase());
    const snippet = idx >= 0
      ? "..." + ct.slice(Math.max(0, idx - 20), idx + 80) + "..."
      : ct.slice(0, 100);

    results.push({ id: row.id, slug: row.slug, title: row.title, type: row.type, score: 1.0, snippet });
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

  // Expand CJK into bigrams so the MATCH aligns with search_tokens column.
  // For pure ASCII queries this is a no-op (buildSearchTokens preserves non-CJK words).
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
           LIMIT ${limit * 3}`
        )
        .all(ftsQuery);
    } catch { /* FTS parse error — fall through to LIKE */ }
  }

  // snippet() column 1 = compiled_truth (human-readable, not bigram tokens)
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

  // LIKE fallback: supplement with LIKE-based matches using the ORIGINAL query
  // words (not bigram tokens) for meaningful substring matching.
  if (results.length < limit) {
    const originalTerms = query.trim().split(/\s+/).filter((t) => t.length >= 1);
    if (originalTerms.length > 0) {
      const likeResults = likeSearch(db, originalTerms, { ...opts, limit: limit - results.length });
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
