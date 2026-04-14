import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchScopeLabels } from "../constants";
import type { SearchScope } from "../types";

type Props = {
  query: string;
  searchScope: SearchScope;
  inputRef: React.RefObject<HTMLInputElement>;
  onQueryChange: (q: string) => void;
  onScopeChange: (scope: SearchScope) => void;
  onClear: () => void;
};

export function SearchBar({ query, searchScope, inputRef, onQueryChange, onScopeChange, onClear }: Props) {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="w-full lg:max-w-[696px] lg:mx-auto xl:ml-[max(0px,calc(50vw-348px-18rem))] flex flex-col gap-0 px-5 py-3 xl:px-0">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            className="h-9 rounded-xl border border-border/80 bg-background pl-9 pr-16 text-sm shadow-none ring-0 placeholder:text-muted-foreground/50 hover:border-border focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30"
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search..."
            ref={inputRef}
            value={query}
          />
          {query.trim() ? (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
              onClick={onClear}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden select-none items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground/60 xl:flex">
              ⌘K
            </kbd>
          )}
        </div>
        {query.trim() ? (
          <div className="flex flex-wrap gap-1.5 pt-2.5">
            {(Object.keys(searchScopeLabels) as SearchScope[]).map((scope) => (
              <button
                key={scope}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  searchScope === scope
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                )}
                onClick={() => onScopeChange(scope)}
                type="button"
              >
                {searchScopeLabels[scope]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
