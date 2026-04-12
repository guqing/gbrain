import { Database } from "bun:sqlite";
import type { BrainEngine } from "./engine.ts";
import type {
  Page, PageInput, PageFilters, PageRow,
  Chunk, ChunkInput,
  SearchResult, SearchOpts,
  Link, GraphNode,
  TimelineEntry, TimelineInput, TimelineOpts,
  RawData, PageVersion,
  BrainStats, BrainHealth,
  IngestLogEntry, IngestLogInput,
} from "../types.ts";
import { ftsSearch, buildSearchTokens } from "./fts.ts";
import { migrateDb } from "./db.ts";

// ── File + Import types ────────────────────────────────────────────────────

export interface FileRecord {
  slug: string;
  sha256: string;
  file_path: string;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  description: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface FileAttachResult {
  slug: string;
  isDuplicate: boolean;
}

export interface FileReferenceMeta {
  source_type?: string;
  source_ref?: string;
  source_item_id?: string;
  source_role?: string;
}

export interface ImportRunRecord {
  id: number;
  source_type: string;
  source_ref: string;
  status: "running" | "completed" | "completed_with_errors" | "failed" | "interrupted";
  total_items: number;
  completed_items: number;
  failed_items: number;
  started_at: string;
  finished_at: string | null;
  summary: string;
}

export interface ImportCheckpointRecord {
  source_type: string;
  source_ref: string;
  item_key: string;
  item_type: string;
  status: "completed" | "failed";
  page_slug: string | null;
  last_run_id: number | null;
  updated_at: string;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function rowToPage(row: PageRow): Page {
  return {
    ...row,
    content_hash: row.content_hash ?? undefined,
    frontmatter: JSON.parse(row.frontmatter),
  };
}

export class SqliteEngine implements BrainEngine {
  constructor(private db: Database) {}

  disconnect(): void {
    this.db.close();
  }

  initSchema(): void {
    migrateDb(this.db);
  }

  // ── Pages ─────────────────────────────────────────────────────────────────

  getPage(slug: string): Page | null {
    const row = this.db
      .query<PageRow, [string]>("SELECT * FROM pages WHERE slug = ? LIMIT 1")
      .get(slug);
    return row ? rowToPage(row) : null;
  }

  // Fuzzy slug resolution: returns the page AND the slug that was resolved.
  // Falls back to FTS5 search on the slug text when exact match fails.
  getPageFuzzy(slug: string): { page: Page; resolved_slug: string } | null {
    const exact = this.getPage(slug);
    if (exact) return { page: exact, resolved_slug: slug };

    // Try FTS5 search using the slug tokens as a query
    const query = slug.replace(/[-_/]/g, ' ').trim();
    if (!query) return null;
    const candidates = this.searchKeyword(query, { limit: 1 });
    if (candidates.length === 0) return null;

    const best = candidates[0]!;
    const page = this.getPage(best.slug);
    return page ? { page, resolved_slug: best.slug } : null;
  }

  putPage(slug: string, input: PageInput): Page {
    const existing = this.db
      .query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1")
      .get(slug);

    const fmJson = JSON.stringify(input.frontmatter ?? {});
    const timeline = input.timeline ?? '';

    // Build CJK-bigram search tokens for the full page text so FTS5 can match
    // 2-character Chinese compounds like "提交"/"邮箱" that unicode61 can't split.
    const rawText = [input.title, input.compiled_truth, timeline].join(" ");
    const searchTokens = buildSearchTokens(rawText);

    if (existing) {
      this.db.run(
        `UPDATE pages SET type=?, title=?, compiled_truth=?, timeline=?, frontmatter=?,
         search_tokens=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE slug=?`,
        [input.type, input.title, input.compiled_truth, timeline, fmJson, searchTokens, slug]
      );
    } else {
      this.db.run(
        `INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, search_tokens)
         VALUES (?,?,?,?,?,?,?)`,
        [slug, input.type, input.title, input.compiled_truth, timeline, fmJson, searchTokens]
      );
    }

    // Sync tags from frontmatter
    const tags = (input.frontmatter?.tags ?? []) as string[];
    const page = this.getPage(slug)!;
    const existingTags = this.getTags(slug);
    const newTagsSet = new Set(tags);
    for (const t of existingTags) {
      if (!newTagsSet.has(t)) this.removeTag(slug, t);
    }
    for (const t of tags) {
      this.addTag(slug, t);
    }

    return page;
  }

  deletePage(slug: string): void {
    this.db.run("DELETE FROM pages WHERE slug = ?", [slug]);
  }

  listPages(filters?: PageFilters): Page[] {
    const limit = filters?.limit ?? 100;
    const offset = filters?.offset ?? 0;
    let rows: PageRow[];

    if (filters?.tag) {
      rows = this.db.query<PageRow, [string]>(
        `SELECT p.* FROM pages p
         JOIN tags t ON t.page_id = p.id
         WHERE t.tag = ?
         ${filters.type ? `AND p.type = '${filters.type}'` : ''}
         ORDER BY p.updated_at DESC
         LIMIT ${limit} OFFSET ${offset}`
      ).all(filters.tag);
    } else if (filters?.type) {
      rows = this.db.query<PageRow, [string]>(
        `SELECT * FROM pages WHERE type = ?
         ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}`
      ).all(filters.type);
    } else {
      rows = this.db.query<PageRow, []>(
        `SELECT * FROM pages ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}`
      ).all();
    }

    return rows.map(rowToPage);
  }

  // ── Search ────────────────────────────────────────────────────────────────

  searchKeyword(query: string, opts?: SearchOpts): SearchResult[] {
    const limit = opts?.limit ?? 10;
    const results: SearchResult[] = [];

    // Page FTS
    try {
      const ftsRows = ftsSearch(this.db, query, { type: opts?.type, limit });
      for (const r of ftsRows) {
        results.push({
          result_kind: 'page',
          slug: r.slug,
          page_id: r.id,
          page_slug: r.slug,
          title: r.title,
          type: r.type,
          chunk_text: r.snippet ?? '',
          chunk_source: 'compiled_truth' as const,
          score: r.score,
          stale: false,
          snippet: r.snippet,
        });
      }
    } catch { /* FTS error */ }

    // File description FTS
    try {
      type FtsFileRow = {
        file_slug: string;
        title: string;
        description: string | null;
        rank: number;
        parent_page_slug: string | null;
        provenance_summary: string | null;
      };
      const fileRows = this.db.query<FtsFileRow, [string, number]>(
        `SELECT
           f.slug AS file_slug,
           COALESCE(f.original_name, f.slug) AS title,
           f.description,
           fts.rank,
           MIN(pf.page_slug) AS parent_page_slug,
           MIN(fr.source_type || ':' || fr.source_ref) AS provenance_summary
         FROM (SELECT rowid, rank FROM fts_files WHERE fts_files MATCH ?) fts
         JOIN files f ON f.rowid = fts.rowid
         LEFT JOIN page_files pf ON pf.file_slug = f.slug
         LEFT JOIN file_references fr ON fr.file_slug = f.slug
         GROUP BY f.slug
         ORDER BY fts.rank LIMIT ?`,
      ).all(query, limit);

      for (const fr of fileRows) {
        results.push({
          result_kind: 'file',
          slug: `file:${fr.file_slug}`,
          page_id: -1,
          file_slug: fr.file_slug,
          parent_page_slug: fr.parent_page_slug ?? undefined,
          title: fr.title,
          type: 'file',
          chunk_text: fr.description ?? '',
          chunk_source: 'file_description' as const,
          provenance_summary: fr.provenance_summary ?? undefined,
          score: Math.abs(fr.rank),
          stale: false,
          snippet: fr.description?.slice(0, 200),
        });
      }
    } catch { /* FTS files error */ }

    // File chunk FTS (v0.6: PDF pages, DOCX paragraphs, audio transcripts)
    try {
      type FtsChunkRow = {
        chunk_id: number;
        file_slug: string;
        title: string;
        chunk_text: string;
        chunk_source: string;
        rank: number;
        parent_page_slug: string | null;
        provenance_summary: string | null;
      };
      const chunkRows = this.db.query<FtsChunkRow, [string, number]>(
        `SELECT
           fc.id AS chunk_id,
           fc.file_slug,
           COALESCE(f.original_name, fc.file_slug) AS title,
           fc.chunk_text,
           fc.chunk_source,
           fts.rank,
           MIN(pf.page_slug) AS parent_page_slug,
           MIN(fr.source_type || ':' || fr.source_ref) AS provenance_summary
         FROM (SELECT rowid, rank FROM fts_file_chunks WHERE fts_file_chunks MATCH ?) fts
         JOIN file_chunks fc ON fc.id = fts.rowid
         JOIN files f ON f.slug = fc.file_slug
         LEFT JOIN page_files pf ON pf.file_slug = f.slug
         LEFT JOIN file_references fr ON fr.file_slug = f.slug
         GROUP BY fc.id
         ORDER BY fts.rank LIMIT ?`,
      ).all(query, limit);

      for (const cr of chunkRows) {
        results.push({
          result_kind: 'file',
          slug: `file:${cr.file_slug}`,
          page_id: -1,
          file_slug: cr.file_slug,
          parent_page_slug: cr.parent_page_slug ?? undefined,
          title: cr.title,
          type: 'file',
          chunk_text: cr.chunk_text,
          chunk_source: cr.chunk_source as 'file_description',
          provenance_summary: cr.provenance_summary ?? undefined,
          score: Math.abs(cr.rank),
          stale: false,
          snippet: cr.chunk_text.slice(0, 200),
        });
      }
    } catch { /* fts_file_chunks may not exist on very old DBs */ }

    return results.slice(0, limit);
  }

  searchVector(embedding: Float32Array, opts?: SearchOpts): SearchResult[] {
    const limit = opts?.limit ?? 20;

    type ChunkRow = { id: number; page_id: number; chunk_text: string; chunk_source: string; embedding: Buffer; model: string };
    const chunks = this.db.query<ChunkRow, []>(
      "SELECT id, page_id, chunk_text, chunk_source, embedding, model FROM content_chunks WHERE embedding IS NOT NULL"
    ).all();

    // File chunks — pre-fetch all file metadata to avoid N+1 queries in the loop
    type FileChunkRow = { id: number; file_slug: string; chunk_text: string; chunk_source: string; embedding: Buffer; model: string };
    const fileChunks = this.db.query<FileChunkRow, []>(
      "SELECT id, file_slug, chunk_text, COALESCE(chunk_source, 'description') AS chunk_source, embedding, model FROM file_chunks WHERE embedding IS NOT NULL"
    ).all();

    // Pre-fetch all file metadata in one query, keyed by file_slug
    const uniqueFileSlugs = [...new Set(fileChunks.map(fc => fc.file_slug))];
    const fileMeta = new Map<string, { original_name: string | null; page_slug: string | null; source_type: string | null; source_ref: string | null }>();
    if (uniqueFileSlugs.length > 0) {
      type FileMetaRow = { file_slug: string; original_name: string | null; page_slug: string | null; source_type: string | null; source_ref: string | null };
      const placeholders = uniqueFileSlugs.map(() => "?").join(",");
      const rows = this.db.query<FileMetaRow, string[]>(
        `SELECT f.slug AS file_slug,
                f.original_name,
                MIN(pf.page_slug) AS page_slug,
                MIN(fr.source_type) AS source_type,
                MIN(fr.source_ref)  AS source_ref
         FROM files f
         LEFT JOIN page_files pf ON pf.file_slug = f.slug
         LEFT JOIN file_references fr ON fr.file_slug = f.slug
         WHERE f.slug IN (${placeholders})
         GROUP BY f.slug`,
      ).all(...uniqueFileSlugs);
      for (const row of rows) {
        fileMeta.set(row.file_slug, row);
      }
    }

    if (chunks.length === 0 && fileChunks.length === 0) return [];

    interface ScoredItem {
      result: SearchResult;
      score: number;
      key: string;
    }

    const allScored: ScoredItem[] = [];

    for (const c of chunks) {
      const vec = new Float32Array(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength / 4);
      const score = cosineSimilarity(embedding, vec);
      allScored.push({
        key: `page:${c.page_id}`,
        score,
        result: {
          result_kind: 'page',
          slug: '', // filled after page lookup
          page_id: c.page_id,
          title: '',
          type: '',
          chunk_text: c.chunk_text,
          chunk_source: c.chunk_source as 'compiled_truth' | 'timeline',
          score,
          stale: false,
        },
      });
    }

    for (const fc of fileChunks) {
      const vec = new Float32Array(fc.embedding.buffer, fc.embedding.byteOffset, fc.embedding.byteLength / 4);
      const score = cosineSimilarity(embedding, vec);
      const meta = fileMeta.get(fc.file_slug);
      const title = meta?.original_name ?? fc.file_slug;
      const provenance_summary = meta?.source_type && meta?.source_ref
        ? `${meta.source_type}:${meta.source_ref}`
        : undefined;
      allScored.push({
        key: `file:${fc.file_slug}`,
        score,
        result: {
          result_kind: 'file',
          slug: `file:${fc.file_slug}`,
          page_id: -1,
          file_slug: fc.file_slug,
          parent_page_slug: meta?.page_slug ?? undefined,
          title,
          type: 'file',
          chunk_text: fc.chunk_text,
          chunk_source: (fc.chunk_source ?? 'file_description') as 'file_description',
          score,
          stale: false,
          provenance_summary,
        },
      });
    }

    allScored.sort((a, b) => b.score - a.score);
    // Filter ghost results: cosine similarity below threshold yields semantically
    // unrelated documents that contaminate RRF scores. 0.25 is a conservative
    // floor — personal KB embeddings for truly relevant content score ≥ 0.3.
    const MIN_COSINE_SIMILARITY = 0.25;
    const top = allScored.filter(item => item.score >= MIN_COSINE_SIMILARITY).slice(0, limit * 3);

    // Resolve page slugs for page results
    const pageIds = [...new Set(top.filter(t => t.result.page_id > 0).map(t => t.result.page_id))];
    const pages = new Map<number, { slug: string; title: string; type: string }>();
    for (const pid of pageIds) {
      const p = this.db.query<{ id: number; slug: string; title: string; type: string }, [number]>(
        "SELECT id, slug, title, type FROM pages WHERE id = ?"
      ).get(pid);
      if (p) pages.set(pid, p);
    }

    // Deduplicate by key (page_id for pages, file_slug for files)
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const { key, score, result } of top) {
      if (seen.has(key)) continue;
      if (result.result_kind === 'page') {
        const page = pages.get(result.page_id);
        if (!page) continue;
        if (opts?.type && page.type !== opts.type) continue;
        if (opts?.exclude_slugs?.includes(page.slug)) continue;
        result.slug = page.slug;
        result.page_slug = page.slug;
        result.title = page.title;
        result.type = page.type;
        result.score = score;
      }
      seen.add(key);
      results.push(result);
      if (results.length >= limit) break;
    }

    return results;
  }

  // Hybrid search: Reciprocal Rank Fusion of FTS5 + vector results.
  // RRF formula: score = sum(1 / (60 + rank)) across both lists.
  // Requires embedding to be pre-computed by caller (pass null to skip vector leg).
  // opts.keywordQuery: use a separate (original/clean) query for FTS to avoid
  // FTS5 parse failures from LLM-expanded queries that contain '…' or special chars.
  hybridSearch(query: string, embedding: Float32Array | null, opts?: SearchOpts & { keywordQuery?: string }): SearchResult[] {
    const limit = opts?.limit ?? 10;
    const rrf_k = 60;

    const kwQuery = opts?.keywordQuery ?? query;
    const kwResults = this.searchKeyword(kwQuery, { ...opts, limit: limit * 3 });
    const vecResults = embedding
      ? this.searchVector(embedding, { ...opts, limit: limit * 3 })
      : [];

    // Build RRF score map keyed by slug
    const scores = new Map<string, { result: SearchResult; rrf: number }>();

    for (let i = 0; i < kwResults.length; i++) {
      const r = kwResults[i]!;
      const rrf = 1 / (rrf_k + i + 1);
      const existing = scores.get(r.slug);
      if (existing) {
        existing.rrf += rrf;
      } else {
        scores.set(r.slug, { result: r, rrf });
      }
    }

    for (let i = 0; i < vecResults.length; i++) {
      const r = vecResults[i]!;
      const rrf = 1 / (rrf_k + i + 1);
      const existing = scores.get(r.slug);
      if (existing) {
        existing.rrf += rrf;
        // Prefer the vector chunk_text (richer context) when both sources hit
        if (r.chunk_text.length > existing.result.chunk_text.length) {
          existing.result = { ...r, score: existing.rrf };
        }
      } else {
        scores.set(r.slug, { result: { ...r, score: rrf }, rrf });
      }
    }

    // Image/file description chunks match many text queries because their
    // LLM-generated descriptions are verbose and semantically rich.
    // Apply a soft penalty so text pages rank above images unless the file
    // result is decisively more relevant. A user querying text knowledge
    // almost never wants an image result surfaced above a page.
    for (const entry of scores.values()) {
      if (
        entry.result.result_kind === 'file' &&
        (entry.result.chunk_source === 'file_description' || entry.result.chunk_source === 'description')
      ) {
        entry.rrf *= 0.35;
      }
    }

    // Title match bonus: if query terms appear in the result title, boost its RRF score.
    // Calibrated to +0.02 for a full match — about 1.2× the top RRF slot (1/(60+1)=0.0164).
    // Large enough to bump rank-2 title-match above rank-1 body-match, but small enough
    // that it does not override the combined BM25F+vector signal for decisive mismatches.
    const titleBonusTerms = kwQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length >= 2);
    if (titleBonusTerms.length > 0) {
      for (const entry of scores.values()) {
        const titleLower = entry.result.title.toLowerCase();
        const matchCount = titleBonusTerms.filter(t => titleLower.includes(t)).length;
        if (matchCount > 0) {
          entry.rrf += 0.02 * (matchCount / titleBonusTerms.length);
        }
      }
    }

    // Cap file/image results: at most 3 file results in any top-K set.
    // When FTS only finds 2-3 text pages, the remaining slots should not all
    // be filled with image descriptions — that degrades result quality severely.
    const MAX_FILE_RESULTS = 3;
    let fileCount = 0;
    return [...scores.values()]
      .sort((a, b) => b.rrf - a.rrf)
      .filter(({ result }) => {
        if (result.result_kind === 'file') {
          if (fileCount >= MAX_FILE_RESULTS) return false;
          fileCount++;
        }
        return true;
      })
      .slice(0, limit)
      .map(({ result, rrf }) => ({ ...result, score: rrf }));
  }

  // ── Chunks ────────────────────────────────────────────────────────────────

  upsertChunks(slug: string, chunks: ChunkInput[]): void {
    const page = this.db.query<{ id: number }, [string]>(
      "SELECT id FROM pages WHERE slug = ? LIMIT 1"
    ).get(slug);
    if (!page) throw new Error(`Page not found: ${slug}`);

    // Use INSERT OR REPLACE (requires UNIQUE INDEX on page_id, chunk_index).
    // The old DELETE+INSERT pattern wipes embeddings on every re-put and risks
    // data loss on interrupt (issue #22 equivalent).
    for (const c of chunks) {
      const embBlob = c.embedding ? Buffer.from(c.embedding.buffer) : null;
      this.db.run(
        `INSERT OR REPLACE INTO content_chunks
           (page_id, chunk_index, chunk_text, chunk_source, embedding, model, token_count, embedded_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          page.id,
          c.chunk_index,
          c.chunk_text,
          c.chunk_source,
          embBlob,
          c.model ?? 'text-embedding-3-small',
          c.token_count ?? null,
          c.embedding ? new Date().toISOString() : null,
        ]
      );
    }
    // Remove any chunks beyond the new set (handles shrinkage)
    const maxIndex = chunks.length - 1;
    this.db.run("DELETE FROM content_chunks WHERE page_id = ? AND chunk_index > ?", [page.id, maxIndex]);
  }

  getChunks(slug: string): Chunk[] {
    const page = this.db.query<{ id: number }, [string]>(
      "SELECT id FROM pages WHERE slug = ? LIMIT 1"
    ).get(slug);
    if (!page) return [];

    type ChunkRow = { id: number; page_id: number; chunk_index: number; chunk_text: string; chunk_source: string; embedding: Buffer | null; model: string; token_count: number | null; embedded_at: string | null; created_at: string };
    const rows = this.db.query<ChunkRow, [number]>(
      "SELECT * FROM content_chunks WHERE page_id = ? ORDER BY chunk_index"
    ).all(page.id);

    return rows.map(r => ({
      ...r,
      chunk_source: r.chunk_source as 'compiled_truth' | 'timeline',
      embedding: r.embedding
        ? new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)
        : null,
    }));
  }

  deleteChunks(slug: string): void {
    const page = this.db.query<{ id: number }, [string]>(
      "SELECT id FROM pages WHERE slug = ? LIMIT 1"
    ).get(slug);
    if (!page) return;
    this.db.run("DELETE FROM content_chunks WHERE page_id = ?", [page.id]);
  }

  // ── Links ─────────────────────────────────────────────────────────────────

  addLink(from: string, to: string, context = '', linkType = ''): void {
    const fromPage = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(from);
    const toPage = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(to);
    if (!fromPage) throw new Error(`Page not found: ${from}`);
    if (!toPage) throw new Error(`Page not found: ${to}`);
    this.db.run(
      "INSERT OR IGNORE INTO links (from_page_id, to_page_id, context, link_type) VALUES (?,?,?,?)",
      [fromPage.id, toPage.id, context, linkType]
    );
  }

  removeLink(from: string, to: string): void {
    const fromPage = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(from);
    const toPage = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(to);
    if (!fromPage || !toPage) return;
    this.db.run("DELETE FROM links WHERE from_page_id = ? AND to_page_id = ?", [fromPage.id, toPage.id]);
  }

  getLinks(slug: string): Link[] {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) return [];
    return this.db.query<{ from_slug: string; to_slug: string; link_type: string; context: string }, [number]>(
      `SELECT p1.slug as from_slug, p2.slug as to_slug, l.link_type, l.context
       FROM links l
       JOIN pages p1 ON l.from_page_id = p1.id
       JOIN pages p2 ON l.to_page_id = p2.id
       WHERE l.from_page_id = ?`
    ).all(page.id);
  }

  getBacklinks(slug: string): Link[] {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) return [];
    return this.db.query<{ from_slug: string; to_slug: string; link_type: string; context: string }, [number]>(
      `SELECT p1.slug as from_slug, p2.slug as to_slug, l.link_type, l.context
       FROM links l
       JOIN pages p1 ON l.from_page_id = p1.id
       JOIN pages p2 ON l.to_page_id = p2.id
       WHERE l.to_page_id = ?`
    ).all(page.id);
  }

  traverseGraph(slug: string, depth = 3): GraphNode[] {
    const visited = new Set<string>();
    const queue: Array<{ slug: string; depth: number }> = [{ slug, depth: 0 }];
    const nodes: GraphNode[] = [];

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.slug)) continue;
      visited.add(item.slug);

      const page = this.db.query<{ id: number; slug: string; title: string; type: string }, [string]>(
        "SELECT id, slug, title, type FROM pages WHERE slug = ?"
      ).get(item.slug);
      if (!page) continue;

      const links = this.getLinks(item.slug);
      nodes.push({
        slug: page.slug,
        title: page.title,
        type: page.type,
        depth: item.depth,
        links: links.map(l => ({ to_slug: l.to_slug, link_type: l.link_type })),
      });

      if (item.depth < depth) {
        for (const l of links) {
          if (!visited.has(l.to_slug)) {
            queue.push({ slug: l.to_slug, depth: item.depth + 1 });
          }
        }
      }
    }

    return nodes;
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  addTag(slug: string, tag: string): void {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) return;
    this.db.run("INSERT OR IGNORE INTO tags (page_id, tag) VALUES (?,?)", [page.id, tag]);
  }

  removeTag(slug: string, tag: string): void {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) return;
    this.db.run("DELETE FROM tags WHERE page_id = ? AND tag = ?", [page.id, tag]);
  }

  getTags(slug: string): string[] {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) return [];
    return this.db.query<{ tag: string }, [number]>(
      "SELECT tag FROM tags WHERE page_id = ? ORDER BY tag"
    ).all(page.id).map(r => r.tag);
  }

  // ── Timeline ──────────────────────────────────────────────────────────────

  addTimelineEntry(slug: string, entry: TimelineInput): void {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) throw new Error(`Page not found: ${slug}`);
    this.db.run(
      "INSERT INTO timeline_entries (page_id, entry_date, source, summary, detail) VALUES (?,?,?,?,?)",
      [page.id, entry.date, entry.source ?? '', entry.summary, entry.detail ?? '']
    );
  }

  getTimeline(slug: string, opts?: TimelineOpts): TimelineEntry[] {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) return [];
    const limit = opts?.limit ?? 100;
    type TRow = { id: number; page_id: number; entry_date: string; source: string; summary: string; detail: string; created_at: string };
    let rows: TRow[];
    if (opts?.after && opts?.before) {
      rows = this.db.query<TRow, [number, string, string]>(
        "SELECT * FROM timeline_entries WHERE page_id = ? AND entry_date > ? AND entry_date < ? ORDER BY entry_date DESC LIMIT " + limit
      ).all(page.id, opts.after, opts.before);
    } else if (opts?.after) {
      rows = this.db.query<TRow, [number, string]>(
        "SELECT * FROM timeline_entries WHERE page_id = ? AND entry_date > ? ORDER BY entry_date DESC LIMIT " + limit
      ).all(page.id, opts.after);
    } else if (opts?.before) {
      rows = this.db.query<TRow, [number, string]>(
        "SELECT * FROM timeline_entries WHERE page_id = ? AND entry_date < ? ORDER BY entry_date DESC LIMIT " + limit
      ).all(page.id, opts.before);
    } else {
      rows = this.db.query<TRow, [number]>(
        "SELECT * FROM timeline_entries WHERE page_id = ? ORDER BY entry_date DESC LIMIT " + limit
      ).all(page.id);
    }
    return rows as TimelineEntry[];
  }

  // ── Raw data ──────────────────────────────────────────────────────────────

  putRawData(slug: string, source: string, data: object): void {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) throw new Error(`Page not found: ${slug}`);
    this.db.run(
      "INSERT OR REPLACE INTO raw_data (page_id, source, data) VALUES (?,?,?)",
      [page.id, source, JSON.stringify(data)]
    );
  }

  getRawData(slug: string, source?: string): RawData[] {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) return [];
    type RawRow = { source: string; data: string; fetched_at: string };
    let rows: RawRow[];
    if (source) {
      rows = this.db.query<RawRow, [number, string]>(
        "SELECT source, data, fetched_at FROM raw_data WHERE page_id = ? AND source = ?"
      ).all(page.id, source);
    } else {
      rows = this.db.query<RawRow, [number]>(
        "SELECT source, data, fetched_at FROM raw_data WHERE page_id = ?"
      ).all(page.id);
    }
    return rows.map(r => ({ source: r.source, data: JSON.parse(r.data), fetched_at: r.fetched_at }));
  }

  // ── Versions ──────────────────────────────────────────────────────────────

  createVersion(slug: string): PageVersion {
    const page = this.getPage(slug);
    if (!page) throw new Error(`Page not found: ${slug}`);
    const result = this.db.run(
      "INSERT INTO page_versions (page_id, compiled_truth, frontmatter) VALUES (?,?,?)",
      [page.id, page.compiled_truth, JSON.stringify(page.frontmatter)]
    );
    const id = Number(result.lastInsertRowid);
    return {
      id,
      page_id: page.id,
      compiled_truth: page.compiled_truth,
      frontmatter: page.frontmatter as Record<string, unknown>,
      snapshot_at: new Date().toISOString(),
    };
  }

  getVersions(slug: string): PageVersion[] {
    const page = this.db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(slug);
    if (!page) return [];
    type VRow = { id: number; page_id: number; compiled_truth: string; frontmatter: string; snapshot_at: string };
    const rows = this.db.query<VRow, [number]>(
      "SELECT * FROM page_versions WHERE page_id = ? ORDER BY snapshot_at DESC"
    ).all(page.id);
    return rows.map(r => ({
      ...r,
      frontmatter: JSON.parse(r.frontmatter),
    }));
  }

  revertToVersion(slug: string, versionId: number): void {
    type VRow = { compiled_truth: string; frontmatter: string };
    const version = this.db.query<VRow, [number]>(
      "SELECT compiled_truth, frontmatter FROM page_versions WHERE id = ?"
    ).get(versionId);
    if (!version) throw new Error(`Version not found: ${versionId}`);
    const fm = JSON.parse(version.frontmatter);
    this.putPage(slug, {
      type: fm.type ?? 'concept',
      title: fm.title ?? slug,
      compiled_truth: version.compiled_truth,
      frontmatter: fm,
    });
  }

  // ── Stats + Health ─────────────────────────────────────────────────────────

  getStats(): BrainStats {
    const totalPages = this.db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM pages").get()?.n ?? 0;
    const byType = Object.fromEntries(
      this.db.query<{ type: string; n: number }, []>(
        "SELECT type, COUNT(*) as n FROM pages GROUP BY type ORDER BY n DESC"
      ).all().map(r => [r.type, r.n])
    );
    const totalLinks = this.db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM links").get()?.n ?? 0;
    const totalTags = this.db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM tags").get()?.n ?? 0;
    const totalEmbeddings = this.db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM content_chunks WHERE embedding IS NOT NULL").get()?.n ?? 0;
    const totalIngestLog = this.db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM ingest_log").get()?.n ?? 0;

    return {
      totalPages,
      byType,
      totalLinks,
      totalTags,
      totalEmbeddings,
      totalIngestLog,
      dbSizeBytes: 0,
      inbox_count: byType['inbox'] ?? 0,
      page_count: totalPages,
      chunk_count: this.db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM content_chunks").get()?.n ?? 0,
      embedded_count: totalEmbeddings,
      link_count: totalLinks,
      tag_count: totalTags,
      timeline_entry_count: this.db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM timeline_entries").get()?.n ?? 0,
      pages_by_type: byType,
    };
  }

  getHealth(): BrainHealth {
    const pageCount = this.db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM pages").get()?.n ?? 0;

    const withEmbeds = this.db.query<{ n: number }, []>(
      "SELECT COUNT(DISTINCT page_id) as n FROM content_chunks WHERE embedding IS NOT NULL"
    ).get()?.n ?? 0;
    const embedCoverage = pageCount > 0 ? (withEmbeds / pageCount) * 100 : 0;

    const today = new Date().toISOString().slice(0, 10);
    const staleRows = this.db.query<{ slug: string; frontmatter: string }, []>(
      "SELECT slug, frontmatter FROM pages"
    ).all();
    let stalePages = 0;
    for (const row of staleRows) {
      try {
        const fm = JSON.parse(row.frontmatter);
        if ((fm.confidence !== undefined && fm.confidence <= 3) ||
            (fm.valid_until && fm.valid_until < today)) {
          stalePages++;
        }
      } catch { /* ignore */ }
    }

    const orphans = this.db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM pages p
       WHERE p.id NOT IN (SELECT from_page_id FROM links)
       AND p.id NOT IN (SELECT to_page_id FROM links)
       AND p.id NOT IN (SELECT page_id FROM tags)`
    ).get()?.n ?? 0;

    const missingEmbeddings = this.db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM pages WHERE id NOT IN (SELECT DISTINCT page_id FROM content_chunks)`
    ).get()?.n ?? 0;

    return {
      page_count: pageCount,
      embed_coverage: Math.round(embedCoverage * 10) / 10,
      stale_pages: stalePages,
      orphan_pages: orphans,
      dead_links: 0,
      missing_embeddings: missingEmbeddings,
    };
  }

  // ── Ingest log ─────────────────────────────────────────────────────────────

  logIngest(entry: IngestLogInput): void {
    this.db.run(
      "INSERT INTO ingest_log (source_type, source_ref, pages_updated, summary) VALUES (?,?,?,?)",
      [entry.source_type, entry.source_ref, JSON.stringify(entry.pages_updated), entry.summary]
    );
  }

  getIngestLog(opts?: { limit?: number }): IngestLogEntry[] {
    const limit = opts?.limit ?? 50;
    type LogRow = { id: number; source_type: string; source_ref: string; pages_updated: string; summary: string; timestamp: string };
    return this.db.query<LogRow, []>(
      `SELECT * FROM ingest_log ORDER BY timestamp DESC LIMIT ${limit}`
    ).all().map(r => ({
      ...r,
      pages_updated: JSON.parse(r.pages_updated),
    }));
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  updateSlug(oldSlug: string, newSlug: string): void {
    this.db.run("UPDATE pages SET slug = ? WHERE slug = ?", [newSlug, oldSlug]);
  }

  rewriteLinks(_oldSlug: string, _newSlug: string): void {
    // Links use page IDs so slug rename doesn't break them
  }

  // ── Config ────────────────────────────────────────────────────────────────

  getConfig(key: string): string | null {
    const row = this.db.query<{ value: string }, [string]>(
      "SELECT value FROM config WHERE key = ?"
    ).get(key);
    return row?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO config (key, value) VALUES (?,?)",
      [key, value]
    );
  }

  // ── brain_meta ────────────────────────────────────────────────────────────

  getMeta(key: string): string | null {
    const row = this.db.query<{ value: string }, [string]>(
      "SELECT value FROM brain_meta WHERE key = ?"
    ).get(key);
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO brain_meta (key, value) VALUES (?,?)",
      [key, value]
    );
  }

  // ── Lint report ───────────────────────────────────────────────────────────

  getLintReport(): import('../types.ts').LintResult {
    const today = new Date().toISOString().slice(0, 10)!;
    const allPages = this.listPages({ limit: 10000 });
    const stale: import('../types.ts').StaleItem[] = [];
    const lowConfidence: import('../types.ts').LowConfidenceItem[] = [];

    for (const page of allPages) {
      // Skip inbox items — they're raw, not knowledge pages
      if (page.type === 'inbox') continue;
      const fm = page.frontmatter as { valid_until?: string; confidence?: number };
      if (fm.valid_until && fm.valid_until < today) {
        stale.push({ slug: page.slug, title: page.title, valid_until: fm.valid_until, confidence: fm.confidence });
      }
      if (fm.confidence !== undefined && fm.confidence < 5) {
        lowConfidence.push({ slug: page.slug, title: page.title, confidence: fm.confidence });
      }
    }

    // Orphans: pages with no outgoing or incoming links (excluding inbox)
    // Single query — O(1) instead of O(n) flatMap
    const linkedSlugsRows = this.db.query<{ slug: string }, []>(
      `SELECT DISTINCT p.slug FROM pages p
       INNER JOIN links l ON l.from_page_id = p.id OR l.to_page_id = p.id
       WHERE p.type != 'inbox'`
    ).all();
    const linkedSlugs = new Set(linkedSlugsRows.map(r => r.slug));
    const orphans = allPages
      .filter(p => p.type !== 'inbox' && !linkedSlugs.has(p.slug))
      .map(p => p.slug);

    // Suggested: [[wiki-links]] mentioned but no page exists
    const existingSlugs = new Set(allPages.map(p => p.slug));
    const mentionCounts = new Map<string, number>();
    for (const page of allPages) {
      if (page.type === 'inbox') continue;
      const content = page.compiled_truth + " " + (page.timeline ?? "");
      for (const match of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const slug = (match[1] ?? "").trim();
        if (!existingSlugs.has(slug)) {
          mentionCounts.set(slug, (mentionCounts.get(slug) ?? 0) + 1);
        }
      }
    }
    const suggested: import('../types.ts').SuggestedItem[] = [...mentionCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([slug, mentionCount]) => ({ slug, mentionCount }));

    // Inbox queue
    const inboxRow = this.db.query<{ count: number; oldest: string | null }, []>(
      `SELECT COUNT(*) as count, MIN(created_at) as oldest FROM pages WHERE type = 'inbox'`
    ).get();

    return {
      stale,
      lowConfidence,
      orphans,
      suggested,
      inbox_queue: {
        count: inboxRow?.count ?? 0,
        oldest_date: inboxRow?.oldest ?? null,
      },
    };
  }

  // ── File management ────────────────────────────────────────────────────────

  attachFileRecord(
    pageSlug: string,
    fileRecord: Omit<FileRecord, 'created_at'>,
  ): FileAttachResult {
    const page = this.getPage(pageSlug);
    if (!page) throw new Error(`Page not found: ${pageSlug}`);

    // Dedup by sha256
    const existing = this.db
      .query<{ slug: string }, [string]>("SELECT slug FROM files WHERE sha256 = ? LIMIT 1")
      .get(fileRecord.sha256);

    let fileSlug: string;
    let isDuplicate = false;

    if (existing) {
      fileSlug = existing.slug;
      isDuplicate = true;
    } else {
      this.db.run(
        `INSERT INTO files (slug, sha256, file_path, original_name, mime_type, size_bytes, description)
         VALUES (?,?,?,?,?,?,?)`,
        [
          fileRecord.slug, fileRecord.sha256, fileRecord.file_path,
          fileRecord.original_name ?? null, fileRecord.mime_type, fileRecord.size_bytes,
          fileRecord.description ?? null,
        ],
      );
      fileSlug = fileRecord.slug;
    }

    const maxOrder = this.db.query<{ max: number | null }, [string]>(
      "SELECT MAX(display_order) as max FROM page_files WHERE page_slug = ?",
    ).get(pageSlug)?.max ?? -1;

    this.db.run(
      `INSERT OR IGNORE INTO page_files (page_slug, file_slug, display_order)
       VALUES (?,?,?)`,
      [pageSlug, fileSlug, maxOrder + 1],
    );

    return { slug: fileSlug, isDuplicate };
  }

  recordFileReference(pageSlug: string, fileSlug: string, ref: FileReferenceMeta): void {
    if (!ref.source_type || !ref.source_ref) return;
    this.db.run(
      `INSERT OR IGNORE INTO file_references
         (page_slug, file_slug, source_type, source_ref, source_item_id, source_role)
       VALUES (?,?,?,?,?,?)`,
      [
        pageSlug, fileSlug,
        ref.source_type, ref.source_ref,
        ref.source_item_id ?? "", ref.source_role ?? null,
      ],
    );
  }

  getFile(slug: string): FileRecord | null {
    return this.db.query<FileRecord, [string]>(
      "SELECT * FROM files WHERE slug = ? LIMIT 1",
    ).get(slug) ?? null;
  }

  listFiles(pageSlug?: string): FileRecord[] {
    if (pageSlug) {
      return this.db.query<FileRecord, [string]>(
        `SELECT f.* FROM files f
         JOIN page_files pf ON pf.file_slug = f.slug
         WHERE pf.page_slug = ?
         ORDER BY pf.display_order`,
      ).all(pageSlug);
    }
    return this.db.query<FileRecord, []>(
      "SELECT * FROM files ORDER BY created_at DESC",
    ).all();
  }

  detachFile(pageSlug: string, fileSlug: string, purge = false): string | null {
    this.db.run(
      "DELETE FROM page_files WHERE page_slug = ? AND file_slug = ?",
      [pageSlug, fileSlug],
    );
    if (!purge) return null;

    const refCount = this.db.query<{ n: number }, [string]>(
      "SELECT COUNT(*) as n FROM page_files WHERE file_slug = ?",
    ).get(fileSlug)?.n ?? 0;

    if (refCount === 0) {
      const f = this.db.query<{ file_path: string }, [string]>(
        "SELECT file_path FROM files WHERE slug = ?",
      ).get(fileSlug);
      this.db.run("DELETE FROM files WHERE slug = ?", [fileSlug]);
      this.db.run("DELETE FROM file_chunks WHERE file_slug = ?", [fileSlug]);
      return f?.file_path ?? null;
    }
    return null;
  }

  setFileDescription(fileSlug: string, description: string): void {
    const exists = this.db.query<{ rowid: number }, [string]>(
      "SELECT rowid FROM files WHERE slug = ? LIMIT 1",
    ).get(fileSlug);
    if (!exists) throw new Error(`File not found: ${fileSlug}`);
    this.db.run("UPDATE files SET description = ? WHERE slug = ?", [description, fileSlug]);
  }

  upsertFileChunk(fileSlug: string, chunkText: string, embedding: Float32Array, model: string): void {
    const embBlob = Buffer.from(embedding.buffer);
    this.db.run(
      `INSERT OR REPLACE INTO file_chunks
         (file_slug, chunk_index, chunk_text, embedding, model, embedded_at)
       VALUES (?,0,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
      [fileSlug, chunkText, embBlob, model],
    );
  }

  /**
   * Bulk-replace all chunks for a file in a single transaction.
   * Deletes existing chunks first to avoid orphaned rows on re-processing.
   * chunks[i] and embeddings[i] must correspond to the same item.
   */
  upsertFileChunks(
    fileSlug: string,
    chunks: Array<{ text: string; source: string }>,
    embeddings: Array<Float32Array | null>,
    model: string,
  ): void {
    if (chunks.length !== embeddings.length) {
      throw new Error(`upsertFileChunks: chunks.length (${chunks.length}) !== embeddings.length (${embeddings.length})`);
    }
    this.db.transaction(() => {
      this.db.run("DELETE FROM file_chunks WHERE file_slug = ?", [fileSlug]);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const emb = embeddings[i];
        const embBlob = emb ? Buffer.from(emb.buffer) : null;
        this.db.run(
          `INSERT INTO file_chunks
             (file_slug, chunk_index, chunk_text, chunk_source, embedding, model, embedded_at)
           VALUES (?,?,?,?,?,?,CASE WHEN ? IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE NULL END)`,
          [fileSlug, i, chunk.text, chunk.source, embBlob, model, embBlob],
        );
      }
    })();
  }

  setProcessedAt(fileSlug: string): void {
    this.db.run(
      `UPDATE files SET processed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE slug = ?`,
      [fileSlug],
    );
  }

  listUndescribedFiles(): FileRecord[] {
    // Backward-compat alias for listUnprocessedFiles().
    return this.listUnprocessedFiles();
  }

  listUnprocessedFiles(): FileRecord[] {
    return this.db.query<FileRecord, []>(
      "SELECT * FROM files WHERE processed_at IS NULL ORDER BY created_at",
    ).all();
  }

  // ── Import runs ────────────────────────────────────────────────────────────

  createImportRun(sourceType: string, sourceRef: string, totalItems: number): ImportRunRecord {
    const result = this.db.run(
      `INSERT INTO import_runs (source_type, source_ref, status, total_items, completed_items, failed_items)
       VALUES (?,?,'running',?,0,0)`,
      [sourceType, sourceRef, totalItems],
    );
    const id = Number(result.lastInsertRowid);
    return this.getImportRun(id)!;
  }

  getImportRun(runId: number): ImportRunRecord | null {
    return this.db.query<ImportRunRecord, [number]>(
      "SELECT * FROM import_runs WHERE id = ? LIMIT 1",
    ).get(runId) ?? null;
  }

  listImportRuns(limit = 20): ImportRunRecord[] {
    return this.db.query<ImportRunRecord, [number]>(
      "SELECT * FROM import_runs ORDER BY started_at DESC LIMIT ?",
    ).all(limit);
  }

  updateImportRunStatus(runId: number, status: ImportRunRecord["status"], summary?: string): void {
    const finished = ["completed", "completed_with_errors", "failed", "interrupted"].includes(status)
      ? "strftime('%Y-%m-%dT%H:%M:%SZ','now')"
      : "NULL";
    this.db.run(
      `UPDATE import_runs SET status = ?, summary = COALESCE(?, summary),
         finished_at = ${finished}
       WHERE id = ?`,
      [status, summary ?? null, runId],
    );
  }

  updateImportRunCounts(runId: number, total: number, completed: number, failed: number): void {
    this.db.run(
      "UPDATE import_runs SET total_items = ?, completed_items = ?, failed_items = ? WHERE id = ?",
      [total, completed, failed, runId],
    );
  }

  upsertImportRunItem(
    runId: number,
    itemKey: string,
    itemType: string,
    status: string,
    meta?: {
      page_slug?: string;
      error_code?: string;
      error_message?: string;
      retryable?: boolean;
    },
  ): void {
    this.db.run(
      `INSERT OR REPLACE INTO import_run_items
         (import_run_id, item_key, item_type, status, page_slug, error_code, error_message, retryable)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        runId, itemKey, itemType, status,
        meta?.page_slug ?? null, meta?.error_code ?? null,
        meta?.error_message ?? null, meta?.retryable ? 1 : 0,
      ],
    );
  }

  getImportCheckpoint(sourceType: string, sourceRef: string, itemKey: string): ImportCheckpointRecord | null {
    return this.db.query<ImportCheckpointRecord, [string, string, string]>(
      "SELECT * FROM import_checkpoints WHERE source_type = ? AND source_ref = ? AND item_key = ? LIMIT 1",
    ).get(sourceType, sourceRef, itemKey) ?? null;
  }

  upsertImportCheckpoint(args: {
    source_type: string;
    source_ref: string;
    item_key: string;
    item_type: string;
    status: "completed" | "failed";
    page_slug?: string;
    last_run_id?: number;
  }): void {
    this.db.run(
      `INSERT OR REPLACE INTO import_checkpoints
         (source_type, source_ref, item_key, item_type, status, page_slug, last_run_id,
          updated_at)
       VALUES (?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
      [
        args.source_type, args.source_ref, args.item_key, args.item_type,
        args.status, args.page_slug ?? null, args.last_run_id ?? null,
      ],
    );
  }
}
