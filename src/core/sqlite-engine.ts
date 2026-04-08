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
import { ftsSearch } from "./fts.ts";
import { migrateDb } from "./db.ts";

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

  putPage(slug: string, input: PageInput): Page {
    const existing = this.db
      .query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1")
      .get(slug);

    const fmJson = JSON.stringify(input.frontmatter ?? {});
    const timeline = input.timeline ?? '';

    if (existing) {
      this.db.run(
        `UPDATE pages SET type=?, title=?, compiled_truth=?, timeline=?, frontmatter=?,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE slug=?`,
        [input.type, input.title, input.compiled_truth, timeline, fmJson, slug]
      );
    } else {
      this.db.run(
        `INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter)
         VALUES (?,?,?,?,?,?)`,
        [slug, input.type, input.title, input.compiled_truth, timeline, fmJson]
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
    try {
      const ftsRows = ftsSearch(this.db, query, { type: opts?.type, limit });
      return ftsRows.map(r => ({
        slug: r.slug,
        page_id: r.id,
        title: r.title,
        type: r.type,
        chunk_text: r.snippet ?? '',
        chunk_source: 'compiled_truth' as const,
        score: r.score,
        stale: false,
        snippet: r.snippet,
      }));
    } catch {
      return [];
    }
  }

  searchVector(embedding: Float32Array, opts?: SearchOpts): SearchResult[] {
    const limit = opts?.limit ?? 20;

    type ChunkRow = { id: number; page_id: number; chunk_text: string; chunk_source: string; embedding: Buffer; model: string };
    const chunks = this.db.query<ChunkRow, []>(
      "SELECT id, page_id, chunk_text, chunk_source, embedding, model FROM content_chunks WHERE embedding IS NOT NULL"
    ).all();

    if (chunks.length === 0) return [];

    const scored = chunks.map(c => {
      const vec = new Float32Array(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength / 4);
      return { chunk: c, score: cosineSimilarity(embedding, vec) };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit * 3);

    const pageIds = [...new Set(top.map(t => t.chunk.page_id))];
    const pages = new Map<number, { slug: string; title: string; type: string }>();
    for (const pid of pageIds) {
      const p = this.db.query<{ id: number; slug: string; title: string; type: string }, [number]>(
        "SELECT id, slug, title, type FROM pages WHERE id = ?"
      ).get(pid);
      if (p) pages.set(pid, p);
    }

    const results: SearchResult[] = [];
    for (const { chunk, score } of top) {
      const page = pages.get(chunk.page_id);
      if (!page) continue;
      if (opts?.type && page.type !== opts.type) continue;
      if (opts?.exclude_slugs?.includes(page.slug)) continue;
      results.push({
        slug: page.slug,
        page_id: chunk.page_id,
        title: page.title,
        type: page.type,
        chunk_text: chunk.chunk_text,
        chunk_source: chunk.chunk_source as 'compiled_truth' | 'timeline',
        score,
        stale: false,
      });
      if (results.length >= limit) break;
    }

    return results;
  }

  // ── Chunks ────────────────────────────────────────────────────────────────

  upsertChunks(slug: string, chunks: ChunkInput[]): void {
    const page = this.db.query<{ id: number }, [string]>(
      "SELECT id FROM pages WHERE slug = ? LIMIT 1"
    ).get(slug);
    if (!page) throw new Error(`Page not found: ${slug}`);

    this.db.run("DELETE FROM content_chunks WHERE page_id = ?", [page.id]);
    for (const c of chunks) {
      const embBlob = c.embedding ? Buffer.from(c.embedding.buffer) : null;
      this.db.run(
        `INSERT INTO content_chunks (page_id, chunk_index, chunk_text, chunk_source, embedding, model, token_count, embedded_at)
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
}
