import type { Section, SearchScope } from "./types";

export const sectionLabels: Record<Section, string> = {
  recent: "Recent",
  concept: "Concepts",
  session: "Sessions",
  inbox: "Inbox",
  file: "Files",
};

export const searchScopeLabels: Record<SearchScope, string> = {
  all: "All",
  pages: "Pages",
  sessions: "Sessions",
  files: "Files",
};

export const sectionRoots: Partial<Record<Section, string>> = {
  concept: "concepts",
  session: "sessions",
  inbox: "inbox",
  file: "files",
};

export const sectionEmptyHints: Record<Section, string> = {
  recent: "No pages yet. Run `exo ingest` to import your first ChatGPT export or document.",
  concept: "No concept pages yet. Concept pages live under `concepts/` in your knowledge base.",
  session: "No session pages yet. Session pages live under `sessions/` in your knowledge base.",
  inbox: "Inbox is empty. Pages pending compilation appear here after ingestion.",
  file: "No files yet. Attach files with `exo attach` or during ingestion.",
};
