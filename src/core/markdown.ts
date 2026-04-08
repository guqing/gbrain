import matter from "gray-matter";
import type { Page, PageFrontmatter, PageRow, PageType } from "../types.ts";

const TIMELINE_SEPARATOR = "\n\n---\n\n## Timeline\n";
const SEPARATOR_REGEX = /\n\n---\n\n## Timeline\n/;

// Parse a full markdown string (with YAML frontmatter) into a Page-like structure
export function parsePage(raw: string, slug: string): Omit<Page, "id" | "created_at" | "updated_at"> {
  const { data, content } = matter(raw);
  const fm = data as PageFrontmatter;

  // Split content on the --- Timeline separator
  const parts = content.split(SEPARATOR_REGEX);
  const compiled_truth = (parts[0] ?? "").trim();
  const timeline = parts[1] ? parts[1].trim() : "";

  // Extract title from first H1, fall back to slug
  const titleMatch = compiled_truth.match(/^#\s+(.+)$/m);
  const title = fm.title as string | undefined
    ?? titleMatch?.[1]
    ?? slugToTitle(slug);

  const type: PageType = (fm.type as PageType) ?? inferType(slug);

  return {
    slug,
    type,
    title,
    compiled_truth,
    timeline,
    frontmatter: fm,
  };
}

// Serialize a Page back to a markdown string (for export / display)
export function serializePage(page: Pick<Page, "title" | "type" | "compiled_truth" | "timeline" | "frontmatter">): string {
  const fm: PageFrontmatter = {
    title: page.title,
    type: page.type,
    ...page.frontmatter,
  };

  const body = page.timeline
    ? `${page.compiled_truth}${TIMELINE_SEPARATOR}${page.timeline}`
    : page.compiled_truth;

  return matter.stringify(body, fm as Record<string, unknown>);
}

// Convert a PageRow (from DB) into a Page
export function rowToPage(row: PageRow): Page {
  return {
    ...row,
    frontmatter: JSON.parse(row.frontmatter) as PageFrontmatter,
  };
}

// Convert a Page's frontmatter to a JSON string for DB storage
export function frontmatterToJson(fm: PageFrontmatter): string {
  return JSON.stringify(fm);
}

function slugToTitle(slug: string): string {
  const name = slug.split("/").pop() ?? slug;
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferType(slug: string): PageType {
  const prefix = slug.split("/")[0] ?? "";
  const map: Record<string, PageType> = {
    concepts: "concept",
    concept: "concept",
    learnings: "learning",
    learning: "learning",
    people: "person",
    person: "person",
    projects: "project",
    project: "project",
    sources: "source",
    source: "source",
  };
  return map[prefix] ?? "concept";
}
