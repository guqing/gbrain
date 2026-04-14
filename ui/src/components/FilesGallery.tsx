import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { sectionEmptyHints } from "../constants";
import type { CenterItem, Section, UISummary } from "../types";

type Props = {
  items: CenterItem[];
  loading: boolean;
  selectedItemKey: string | null;
  summary: UISummary | null;
  section: Section;
  onLightbox: (src: string, alt: string) => void;
  onNavigatePage: (slug: string) => void;
};

export function FilesGallery({ items, loading, selectedItemKey, summary, section, onLightbox, onNavigatePage }: Props) {
  if (loading) {
    return (
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-5 py-8 xl:px-8 xl:py-10">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <div key={n} className="overflow-hidden rounded-xl border bg-muted/30 animate-pulse">
                <div className="h-40 w-full bg-muted" />
                <div className="p-2"><div className="h-3 w-3/4 rounded bg-muted" /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-5 py-8 xl:px-8 xl:py-10">
          <p className="text-sm text-muted-foreground">{sectionEmptyHints[section]}</p>
        </div>
      </div>
    );
  }

  // Group by parent page
  const groups = new Map<string, { title: string; slug: string | null; items: CenterItem[] }>();
  for (const item of items) {
    const key = item.parent_page_slug ?? "__unattached__";
    const label = item.parent_page_title ?? item.parent_page_slug ?? "Unattached files";
    if (!groups.has(key)) groups.set(key, { title: label, slug: item.parent_page_slug ?? null, items: [] });
    groups.get(key)!.items.push(item);
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 xl:px-8 xl:py-10">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">Files</h2>
          <span className="text-sm text-muted-foreground">{summary?.collections.file ?? items.length} files</span>
        </div>

        <div className="space-y-10">
          {[...groups.values()].map((group) => (
            <div key={group.slug ?? "__unattached__"}>
              <div className="mb-4 flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">{group.title}</h3>
                {group.slug && (
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    type="button"
                    onClick={() => onNavigatePage(group.slug!)}
                  >
                    <ArrowUpRight className="size-3" />
                    View page
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {group.items.map((file) => {
                  const fileSlug = file.slug.replace("file:", "");
                  const src = `/api/file/${encodeURIComponent(fileSlug)}/raw`;
                  const isImage = file.mime_type?.startsWith("image/");
                  return (
                    <button
                      id={`gc-${file.slug}`}
                      key={file.slug}
                      className={cn(
                        "group overflow-hidden rounded-xl border text-left transition-all hover:border-primary/40",
                        file.slug === selectedItemKey
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20 ring-offset-1"
                          : "border-border bg-muted/30"
                      )}
                      type="button"
                      onClick={() => {
                        if (isImage) onLightbox(src, file.title);
                        else window.open(src, "_blank");
                      }}
                    >
                      {isImage ? (
                        <img
                          alt={file.title}
                          className="h-40 w-full object-cover transition-transform group-hover:scale-[1.02]"
                          loading="lazy"
                          src={src}
                        />
                      ) : (
                        <div className="flex h-40 items-center justify-center bg-muted/50">
                          <span className="text-xs text-muted-foreground/50">file</span>
                        </div>
                      )}
                      <div className="p-2">
                        <div className="truncate text-xs font-medium text-foreground">{file.title}</div>
                        {file.mime_type && (
                          <div className="truncate text-[11px] text-muted-foreground">{file.mime_type}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
