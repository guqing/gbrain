/**
 * Remark-based markdown utilities.
 *
 * Provides a proper AST pipeline for:
 *   - Heading ID injection (consistent between TOC sidebar and rendered page)
 *   - TOC extraction (replaces the old regex-based extractHeadings)
 */
import { slugifyWithCounter } from "@sindresorhus/slugify";
import type { Heading as MdastHeading, Root } from "mdast";
import { remark } from "remark";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Heading } from "../types";

// ---------------------------------------------------------------------------
// Shared slugify helpers
// ---------------------------------------------------------------------------

type SlugifyFn = ReturnType<typeof slugifyWithCounter>;

function makeSlugify(): SlugifyFn {
  return slugifyWithCounter();
}

/**
 * Turn raw heading text into a URL-safe anchor ID.
 * Handles CJK by percent-encoding non-ASCII, then slugifying the result.
 */
function toSlug(text: string, fn: SlugifyFn): string {
  // Percent-encode non-ASCII characters so CJK etc. become anchor-safe
  const encoded = encodeURIComponent(text);
  if (/%[0-9A-F]{2}/i.test(encoded)) {
    // Contains percent-encoded chars — preserve them as-is with slugify
    return fn(encoded, { decamelize: false, preserveLeadingUnderscore: false });
  }
  return fn(text, { decamelize: false });
}

// ---------------------------------------------------------------------------
// Base remark processor (no heading-ID plugin — used for TOC extraction)
// ---------------------------------------------------------------------------

const baseProcessor = remark()
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm)
  .freeze();

// ---------------------------------------------------------------------------
// Remark plugin: inject IDs into heading nodes via hProperties
// ---------------------------------------------------------------------------

export type RemarkHeadingIdsOptions = {
  /** Max heading depth to process (default 4) */
  maxDepth?: number;
};

/**
 * Remark plugin that adds stable `id` attributes to heading nodes.
 * Uses `@sindresorhus/slugify` with counter to de-duplicate duplicate headings.
 * The IDs are injected as `hast` properties so ReactMarkdown renders them
 * automatically without custom heading components.
 */
export function remarkHeadingIds(options: RemarkHeadingIdsOptions = {}) {
  const { maxDepth = 4 } = options;
  return (tree: Root) => {
    const slugify = makeSlugify();
    visit(tree, "heading", (node: MdastHeading) => {
      if (node.depth > maxDepth) return;
      const text = headingNodeText(node);
      const id = toSlug(text, slugify);
      node.data ??= {};
      node.data.hProperties ??= {};
      (node.data.hProperties as Record<string, unknown>).id = id;
    });
  };
}

// ---------------------------------------------------------------------------
// Extract headings (TOC) from a markdown string
// ---------------------------------------------------------------------------

/**
 * Parse markdown and extract all headings up to `maxDepth`, with stable IDs
 * that exactly match what `remarkHeadingIds` will inject at render time.
 */
export function extractHeadings(markdown: string, maxDepth = 4): Heading[] {
  const tree = baseProcessor().parse(markdown) as Root;
  const headings: Heading[] = [];
  const slugify = makeSlugify();

  visit(tree, "heading", (node: MdastHeading) => {
    if (node.depth > maxDepth) return;
    const text = headingNodeText(node);
    const id = toSlug(text, slugify);
    headings.push({ id, text, level: node.depth });
  });

  return headings;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract plain text content from an mdast heading node. */
function headingNodeText(node: MdastHeading): string {
  const parts: string[] = [];
  visit(node, (child) => {
    if (child.type === "text" || child.type === "inlineCode") {
      parts.push((child as { value: string }).value);
    }
  });
  return parts.join("").trim();
}
