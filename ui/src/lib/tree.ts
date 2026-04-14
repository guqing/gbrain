import type { CenterItem, Section, TreeNode } from "../types";
import { sectionRoots } from "../constants";

function prettifySegment(segment: string): string {
  return segment.replace(/^file:/, "").replace(/[-_]/g, " ");
}

export function resolveReaderSlug(item: CenterItem): string | null {
  if ((item.result_kind === "file" || item.type === "file") && item.mime_type?.startsWith("image/")) return null;
  return item.result_kind === "file" || item.type === "file" ? item.parent_page_slug ?? null : item.slug;
}

export function treeSegmentsForItem(item: CenterItem, section: Section, query: string): string[] {
  if (item.type === "file") {
    const parentLabel =
      item.parent_page_title ??
      (item.parent_page_slug
        ? prettifySegment(item.parent_page_slug.split("/").filter(Boolean).pop() ?? item.parent_page_slug)
        : null);
    if (parentLabel) return [parentLabel, item.title];
    return [item.title];
  }

  const source = item.parent_page_slug ?? item.slug;
  let segments = source.split("/").filter(Boolean);
  const root = sectionRoots[section];

  if (!query.trim() && root && segments[0] === root && segments.length > 1) {
    segments = segments.slice(1);
  }

  if (segments.length <= 1) return [item.sidebar_title ?? item.title];
  return [...segments.slice(0, -1).map(prettifySegment), item.sidebar_title ?? item.title];
}

export function buildTree(items: CenterItem[], section: Section, query: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const branches = new Map<string, TreeNode & { kind: "branch" }>();

  const ensureBranch = (id: string, label: string, parent: TreeNode[]) => {
    const existing = branches.get(id);
    if (existing) return existing;
    const next: TreeNode & { kind: "branch" } = { kind: "branch", id, label, children: [] };
    branches.set(id, next);
    parent.push(next);
    return next;
  };

  items.forEach((item) => {
    const segments = treeSegmentsForItem(item, section, query);
    let level = roots;
    const branchParts: string[] = [];

    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      if (isLeaf) {
        level.push({ kind: "leaf", id: `${item.slug}:${index}`, label: segment, item });
        return;
      }
      branchParts.push(segment);
      const branchId = branchParts.join("/");
      const branch = ensureBranch(branchId, segment, level);
      level = branch.children;
    });
  });

  return roots;
}
