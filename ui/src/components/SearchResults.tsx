import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUpdatedAt, highlightTerms } from "../lib/format";
import type { CenterItem } from "../types";

type Props = {
  query: string;
  items: CenterItem[];
  loading: boolean;
  error: string | null;
  warning: string | null;
  onSelect: (item: CenterItem) => void;
};

export function SearchResults({ query, items, loading, error, warning, onSelect }: Props) {
  return (
    <div className="overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-5 py-8 xl:px-8 xl:py-10">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">
            {loading ? "Searching…" : `${items.length} result${items.length === 1 ? "" : "s"} for`}{" "}
            {!loading && <span className="text-primary">"{query}"</span>}
          </h2>
          {warning ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="size-3.5" />
              {warning}
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div className="space-y-2 rounded-xl border bg-background/70 p-5" key={n}>
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
        ) : null}

        {!loading && error ? (
          <Card className="border-red-200 bg-red-50/80 text-red-950">
            <CardContent className="p-5 text-sm leading-6">{error}</CardContent>
          </Card>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-background/80 px-6 py-12 text-center">
            <p className="text-base font-medium">No results for "{query}"</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try different words, or switch the scope filter above.
            </p>
          </div>
        ) : null}

        {!loading && !error && items.map((item) => (
          <button
            key={`${item.slug}:${item.score ?? ""}`}
            className="group flex w-full flex-col gap-3 rounded-xl border bg-background px-5 py-4 text-left transition-all hover:border-primary/40 hover:bg-primary/[0.03] hover:shadow-sm"
            onClick={() => onSelect(item)}
            type="button"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="muted">{item.result_kind === "file" ? "file" : item.type}</Badge>
                {item.has_files ? <Badge variant="outline">attachments</Badge> : null}
                {item.mime_type ? <Badge variant="outline">{item.mime_type}</Badge> : null}
              </div>
              <span className="text-xs text-muted-foreground">
                {item.updated_at ? formatUpdatedAt(item.updated_at) : item.result_kind === "file" ? "file" : "page"}
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="text-base font-semibold group-hover:text-primary">
                {highlightTerms(item.title, query)}
              </div>
              <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                {highlightTerms(item.chunk_text ?? item.preview ?? "", query)}
              </p>
            </div>
            <div className="truncate text-xs text-muted-foreground/60">{item.slug}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
