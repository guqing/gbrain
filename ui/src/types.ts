export type Section = "recent" | "concept" | "session" | "inbox" | "file";
export type SearchScope = "all" | "pages" | "sessions" | "files";

export type CenterItem = {
  slug: string;
  title: string;
  sidebar_title?: string;
  type: string;
  updated_at: string;
  has_files: boolean;
  preview: string;
  score?: number;
  chunk_text?: string;
  result_kind?: "page" | "file";
  parent_page_slug?: string | null;
  parent_page_title?: string | null;
  mime_type?: string;
};

export type SearchResponse = {
  results: Array<{
    slug: string;
    title: string;
    type: string;
    score: number;
    chunk_text: string;
    result_kind?: "page" | "file";
    parent_page_slug?: string;
  }>;
  degraded: boolean;
  warning: string | null;
};

export type UISummary = {
  total_pages: number;
  total_files: number;
  embedded_pages: number;
  vector_enabled: boolean;
  collections: Record<Section, number>;
};

export type ReaderPayload = {
  slug: string;
  title: string;
  sidebar_title?: string;
  markdown: string;
  metadata: {
    type: string;
    updated_at: string;
    tags?: string[];
    keywords?: string[];
    has_files: boolean;
    confidence?: number | null;
    last_verified?: string | null;
    source_count?: number;
  };
  files: Array<{
    slug: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    download_url: string;
  }>;
  related: Array<{
    slug: string;
    title: string;
    type: string;
  }>;
};

export type Heading = {
  id: string;
  text: string;
  level: number;
};

export type TreeNode =
  | {
      kind: "branch";
      id: string;
      label: string;
      children: TreeNode[];
    }
  | {
      kind: "leaf";
      id: string;
      label: string;
      item: CenterItem;
    };
