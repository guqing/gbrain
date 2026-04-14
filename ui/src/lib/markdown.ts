// extractHeadings is now backed by the remark AST pipeline for accuracy.
export { extractHeadings } from "./remark";

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
