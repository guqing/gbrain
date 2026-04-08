// Shared types used across the entire codebase

export interface Page {
  id: number;
  slug: string;
  type: PageType;
  title: string;
  compiled_truth: string;
  timeline: string;
  frontmatter: PageFrontmatter;
  content_hash?: string;
  created_at: string;
  updated_at: string;
}

export type PageType =
  | "concept"
  | "learning"
  | "person"
  | "project"
  | "source"
  | string;

export interface PageFrontmatter {
  tags?: string[];
  type?: PageType;
  confidence?: number;
  valid_until?: string;
  last_verified?: string;
  version_applies_to?: string;
  sources?: string[];
  [key: string]: unknown;
}

export interface PageInput {
  type: PageType;
  title: string;
  compiled_truth: string;
  timeline?: string;
  frontmatter?: PageFrontmatter;
}

export interface PageFilters {
  type?: PageType;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface PageRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  timeline: string;
  frontmatter: string; // JSON string in DB
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

// Chunks
export interface Chunk {
  id: number;
  page_id: number;
  chunk_index: number;
  chunk_text: string;
  chunk_source: 'compiled_truth' | 'timeline';
  embedding: Float32Array | null;
  model: string;
  token_count: number | null;
  embedded_at: string | null;
  created_at: string;
}

export interface ChunkInput {
  chunk_index: number;
  chunk_text: string;
  chunk_source: 'compiled_truth' | 'timeline';
  embedding?: Float32Array;
  model?: string;
  token_count?: number;
}

export interface SearchResult {
  slug: string;
  page_id: number;
  title: string;
  type: string;
  chunk_text: string;
  chunk_source: 'compiled_truth' | 'timeline';
  score: number;
  stale: boolean;
  snippet?: string;
}

export interface SearchOpts {
  limit?: number;
  type?: PageType;
  exclude_slugs?: string[];
}

export interface Link {
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
}

export interface GraphNode {
  slug: string;
  title: string;
  type: string;
  depth: number;
  links: { to_slug: string; link_type: string }[];
}

export interface TimelineEntry {
  id: number;
  page_id: number;
  entry_date: string;
  source: string;
  summary: string;
  detail: string;
  created_at: string;
}

export interface TimelineInput {
  date: string;
  source?: string;
  summary: string;
  detail?: string;
}

export interface TimelineOpts {
  limit?: number;
  after?: string;
  before?: string;
}

export interface RawData {
  source: string;
  data: Record<string, unknown>;
  fetched_at: string;
}

export interface PageVersion {
  id: number;
  page_id: number;
  compiled_truth: string;
  frontmatter: Record<string, unknown>;
  snapshot_at: string;
}

export interface BrainStats {
  totalPages: number;
  byType: Record<string, number>;
  totalLinks: number;
  totalTags: number;
  totalEmbeddings: number;
  totalIngestLog: number;
  dbSizeBytes: number;
  // New fields
  page_count?: number;
  chunk_count?: number;
  embedded_count?: number;
  link_count?: number;
  tag_count?: number;
  timeline_entry_count?: number;
  pages_by_type?: Record<string, number>;
}

export interface BrainHealth {
  page_count: number;
  embed_coverage: number;
  stale_pages: number;
  orphan_pages: number;
  dead_links: number;
  missing_embeddings: number;
}

export interface IngestLogEntry {
  id: number;
  source_type: string;
  source_ref: string;
  pages_updated: string[];
  summary: string;
  timestamp: string;
}

export interface IngestLogInput {
  source_type: string;
  source_ref: string;
  pages_updated: string[];
  summary: string;
}

export interface LintResult {
  stale: StaleItem[];
  lowConfidence: LowConfidenceItem[];
  orphans: string[];
  suggested: SuggestedItem[];
}

export interface StaleItem {
  slug: string;
  title: string;
  valid_until: string;
  confidence?: number;
}

export interface LowConfidenceItem {
  slug: string;
  title: string;
  confidence: number;
}

export interface SuggestedItem {
  slug: string;
  mentionCount: number;
}
