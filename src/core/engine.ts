import type {
  Page, PageInput, PageFilters,
  Chunk, ChunkInput,
  SearchResult, SearchOpts,
  Link, GraphNode,
  TimelineEntry, TimelineInput, TimelineOpts,
  RawData,
  PageVersion,
  BrainStats, BrainHealth,
  IngestLogEntry, IngestLogInput,
  LintResult,
} from '../types.ts';

export interface BrainEngine {
  // Lifecycle
  disconnect(): void;
  initSchema(): void;

  // Pages CRUD
  getPage(slug: string): Page | null;
  putPage(slug: string, page: PageInput): Page;
  deletePage(slug: string): void;
  listPages(filters?: PageFilters): Page[];

  // Search
  searchKeyword(query: string, opts?: SearchOpts): SearchResult[];
  searchVector(embedding: Float32Array, opts?: SearchOpts): SearchResult[];

  // Chunks
  upsertChunks(slug: string, chunks: ChunkInput[]): void;
  getChunks(slug: string): Chunk[];
  deleteChunks(slug: string): void;

  // Links
  addLink(from: string, to: string, context?: string, linkType?: string): void;
  removeLink(from: string, to: string): void;
  getLinks(slug: string): Link[];
  getBacklinks(slug: string): Link[];
  traverseGraph(slug: string, depth?: number): GraphNode[];

  // Tags
  addTag(slug: string, tag: string): void;
  removeTag(slug: string, tag: string): void;
  getTags(slug: string): string[];

  // Timeline
  addTimelineEntry(slug: string, entry: TimelineInput): void;
  getTimeline(slug: string, opts?: TimelineOpts): TimelineEntry[];

  // Raw data
  putRawData(slug: string, source: string, data: object): void;
  getRawData(slug: string, source?: string): RawData[];

  // Versions
  createVersion(slug: string): PageVersion;
  getVersions(slug: string): PageVersion[];
  revertToVersion(slug: string, versionId: number): void;

  // Stats + health
  getStats(): BrainStats;
  getHealth(): BrainHealth;
  getLintReport(): LintResult;

  // brain_meta KV
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;

  // Ingest log
  logIngest(entry: IngestLogInput): void;
  getIngestLog(opts?: { limit?: number }): IngestLogEntry[];

  // Sync
  updateSlug(oldSlug: string, newSlug: string): void;
  rewriteLinks(oldSlug: string, newSlug: string): void;

  // Config
  getConfig(key: string): string | null;
  setConfig(key: string, value: string): void;
}
