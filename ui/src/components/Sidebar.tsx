import { BrainCircuit } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { sectionLabels, searchScopeLabels } from "../constants";
import { NavTree } from "./NavTree";
import type { CenterItem, Section, SearchScope, TreeNode, UISummary } from "../types";

type Props = {
  section: Section;
  query: string;
  searchScope: SearchScope;
  tree: TreeNode[];
  selectedItemKey: string | null;
  selectedReaderSlug: string | null;
  collapsed: Record<string, boolean>;
  currentTreePath: string[];
  summary: UISummary | null;
  hasMore: boolean;
  loadingMore: boolean;
  onSectionChange: (section: Section) => void;
  onSelect: (item: CenterItem) => void;
  onToggle: (id: string) => void;
  onLoadMore: () => void;
};

export function Sidebar({
  section, query, searchScope, tree, selectedItemKey, selectedReaderSlug,
  collapsed, currentTreePath, summary, hasMore, loadingMore,
  onSectionChange, onSelect, onToggle, onLoadMore,
}: Props) {
  return (
    <aside className="overflow-hidden border-b border-border bg-sidebar/95 xl:sticky xl:top-0 xl:h-screen xl:border-b-0 xl:border-r">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {/* Brand */}
        <div className="px-5 pb-4 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <BrainCircuit className="size-5" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight">exo</div>
              <div className="text-xs text-sidebar-muted">knowledge browser</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden pb-6">
          <div className="w-full overflow-x-hidden space-y-6 px-4 pb-2">
            {/* Section navigation */}
            <div className="space-y-3">
              <div className="px-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Browse</div>
              <div className="space-y-1">
                {(Object.keys(sectionLabels) as Section[]).map((entry) => (
                  <button
                    key={entry}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-2 overflow-hidden rounded-xl px-3 text-left transition-colors",
                      entry === section
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    onClick={() => onSectionChange(entry)}
                    type="button"
                  >
                    <span className="min-w-0 truncate font-medium">{sectionLabels[entry]}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {summary?.collections[entry] ?? "—"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Directory tree */}
            <div className="space-y-3">
              <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden px-2">
                <div className="shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {query.trim() ? "Matching paths" : "Directory structure"}
                </div>
                <Badge className="max-w-[120px] truncate" variant="muted">
                  {query.trim() ? searchScopeLabels[searchScope] : sectionLabels[section]}
                </Badge>
              </div>
              <nav className="space-y-1">
                <NavTree
                  nodes={tree}
                  selectedItemKey={selectedItemKey}
                  selectedReaderSlug={selectedReaderSlug}
                  collapsed={collapsed}
                  currentTreePath={currentTreePath}
                  onSelect={onSelect}
                  onToggle={onToggle}
                />
              </nav>
              {hasMore && !query.trim() && (
                <button
                  className="mt-2 w-full rounded-xl px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  disabled={loadingMore}
                  type="button"
                  onClick={onLoadMore}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
