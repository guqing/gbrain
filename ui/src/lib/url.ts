import type { Section, SearchScope } from "../types";

export function parseSection(value: string | null): Section {
  if (value === "concept" || value === "session" || value === "inbox" || value === "file") return value;
  return "recent";
}

export function parseSearchScope(value: string | null): SearchScope {
  if (value === "pages" || value === "sessions" || value === "files") return value;
  return "all";
}

export function sectionForPageType(value: string): Section {
  if (value === "concept" || value === "session" || value === "inbox" || value === "file") return value;
  return "recent";
}

export function buildUrl(section: Section, slug: string | null, query: string, scope: SearchScope): string {
  const params = new URLSearchParams();
  params.set("section", section);
  if (slug) params.set("slug", slug);
  if (query.trim()) params.set("q", query.trim());
  if (scope !== "all") params.set("scope", scope);
  return `/?${params.toString()}`;
}
