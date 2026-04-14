import type { Heading } from "../types";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();

  markdown.split("\n").forEach((line) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (!match) return;
    const text = match[2]!.trim();
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    headings.push({
      id: count === 0 ? base : `${base}-${count + 1}`,
      text,
      level: match[1]!.length,
    });
  });

  return headings;
}

export function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const newlineClose = markdown.indexOf("\n---", 3);
  if (newlineClose !== -1) return markdown.slice(newlineClose + 4).replace(/^\n+/, "");
  const inlineClose = markdown.indexOf(" ---", 3);
  if (inlineClose !== -1) return markdown.slice(inlineClose + 4).replace(/^\s+/, "");
  return "";
}

export function stripLeadingTitle(markdown: string, title: string): string {
  const stripped = stripFrontmatter(markdown);
  const lines = stripped.split("\n");
  const firstLine = lines[0]?.trim();
  if (firstLine === `# ${title}`) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return stripped;
}

export function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/^---[\s\S]*?---\n?/, "")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}

export function firstParagraph(markdown: string): string {
  const stripped = stripFrontmatter(markdown);
  return (
    stripped
      .split("\n\n")
      .map((block) =>
        block
          .replace(/^#+\s+/gm, "")
          .replace(/[*_`~]/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .trim()
      )
      .find((block) => block.length > 20) ?? ""
  );
}
