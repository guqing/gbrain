// Shared types used across the entire codebase

export interface Page {
  id: number;
  slug: string;
  type: PageType;
  title: string;
  compiled_truth: string;
  timeline: string;
  frontmatter: PageFrontmatter;
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
  confidence?: number;        // 1-10, how confident this knowledge is still accurate
  valid_until?: string;       // ISO date, after which lint flags as stale
  last_verified?: string;     // ISO date
  version_applies_to?: string; // e.g. "React 19", "Bun 1.3"
  sources?: string[];
  [key: string]: unknown;
}

export interface PageRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  timeline: string;
  frontmatter: string; // JSON string in DB
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  slug: string;
  title: string;
  type: string;
  score: number;
  snippet: string;
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

export interface BrainStats {
  totalPages: number;
  byType: Record<string, number>;
  totalLinks: number;
  totalTags: number;
  totalEmbeddings: number;
  totalIngestLog: number;
  dbSizeBytes: number;
}
