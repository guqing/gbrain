export interface ImportUnit {
  /** Resume / idempotency key, e.g. conversation ID. Must be unique within a source. */
  item_key: string;
  item_type: string; // "conversation"
  page_slug: string;
  page_input: {
    type: string;
    title: string;
    compiled_truth: string;
  };
  attachments: Array<{
    /** Absolute path to the file on disk */
    file_path: string;
    source_item_id?: string;
    source_role?: string;
  }>;
}

export const IMPORT_RUN_STATUSES = [
  "running",
  "completed",
  "completed_with_errors",
  "failed",
  "interrupted",
] as const;

export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

export const IMPORT_ITEM_STATUSES = [
  "pending",
  "completed",
  "failed",
  "skipped",
] as const;

export type ImportItemStatus = (typeof IMPORT_ITEM_STATUSES)[number];

export interface ImportAdapter {
  source_type: string;
  scan(sourceRef: string): AsyncIterable<ImportUnit>;
}

export interface ImportRunProgress {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
}
