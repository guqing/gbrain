import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveReaderSlug } from "../lib/tree";
import type { CenterItem, TreeNode } from "../types";

type Props = {
  nodes: TreeNode[];
  depth?: number;
  selectedItemKey: string | null;
  selectedReaderSlug: string | null;
  collapsed: Record<string, boolean>;
  currentTreePath: string[];
  onSelect: (item: CenterItem) => void;
  onToggle: (id: string) => void;
};

export function NavTree({
  nodes,
  depth = 0,
  selectedItemKey,
  selectedReaderSlug,
  collapsed,
  currentTreePath,
  onSelect,
  onToggle,
}: Props) {
  return (
    <ul className="space-y-px">
      {nodes.map((node) => {
        if (node.kind === "leaf") {
          const readerSlug = resolveReaderSlug(node.item);
          const active =
            node.item.slug === selectedItemKey ||
            (readerSlug !== null && readerSlug === selectedReaderSlug);
          return (
            <li key={node.id} className="relative scroll-m-4 first:scroll-m-20">
              <button
                className={cn(
                  "group flex w-full cursor-pointer items-start gap-x-2.5 break-words hyphens-auto rounded-xl py-1.5 pr-3 text-left text-[14px] outline-offset-[-1px] transition-colors",
                  active
                    ? "bg-primary/10 text-primary [text-shadow:-0.2px_0_0_currentColor,0.2px_0_0_currentColor]"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
                onClick={() => onSelect(node.item)}
                style={{ paddingLeft: `${depth * 16 + 16}px` }}
                type="button"
              >
                <span className="min-w-0 max-w-full break-words [word-break:break-word]">{node.label}</span>
              </button>
            </li>
          );
        }

        const isCollapsed = collapsed[node.id] ?? true;
        const inCurrentPath = currentTreePath.join("/").startsWith(node.id);

        return (
          <li key={node.id} className="relative scroll-m-4">
            <button
              className={cn(
                "group flex w-full cursor-pointer items-start gap-x-2.5 break-words hyphens-auto rounded-xl py-1.5 pr-3 text-left text-[14px] font-medium outline-offset-[-1px] transition-colors",
                inCurrentPath
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
              onClick={() => onToggle(node.id)}
              style={{ paddingLeft: `${depth * 16 + 16}px` }}
              type="button"
            >
              <ChevronRight
                className={cn(
                  "mt-[3px] size-3.5 shrink-0 opacity-50 transition-transform",
                  !isCollapsed && "rotate-90"
                )}
              />
              <span className="min-w-0 max-w-full break-words [word-break:break-word]">{node.label}</span>
            </button>
            {!isCollapsed && (
              <NavTree
                nodes={node.children}
                depth={depth + 1}
                selectedItemKey={selectedItemKey}
                selectedReaderSlug={selectedReaderSlug}
                collapsed={collapsed}
                currentTreePath={currentTreePath}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
