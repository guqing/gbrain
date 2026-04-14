import { ArrowUpRight, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatUpdatedAt } from "../lib/format";
import type { Heading, ReaderPayload, Section } from "../types";
import { sectionForPageType } from "../lib/url";

type Props = {
  headings: Heading[];
  activeHeading: string | null;
  reader: ReaderPayload | null;
  onNavigate: (slug: string, section: Section) => void;
};

export function TocSidebar({ headings, activeHeading, reader, onNavigate }: Props) {
  return (
    <div className="hidden xl:block shrink-0 w-[18rem] self-start sticky top-[3.75rem] h-[calc(100vh-3.75rem)] mr-8">
      <div className="overflow-y-auto h-full pl-8 pr-4 py-8">
        <div className="space-y-6 pb-10 text-sm leading-6">

          {headings.length > 0 ? (
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                On this page
              </div>
              <div className="space-y-0.5">
                {headings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={cn(
                      "block border-l-2 py-1 text-sm leading-6 transition-colors",
                      activeHeading === heading.id
                        ? "border-primary font-medium text-primary"
                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                    )}
                    style={{ paddingLeft: `${0.625 + (heading.level - 1) * 0.75}rem` }}
                  >
                    {heading.text}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {reader ? (
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                Details
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <span>Updated</span>
                  <span className="font-medium text-foreground">{formatUpdatedAt(reader.metadata.updated_at)}</span>
                </div>
                {reader.metadata.confidence ? (
                  <div className="flex justify-between gap-2">
                    <span>Confidence</span>
                    <span className="font-medium text-foreground">{reader.metadata.confidence}</span>
                  </div>
                ) : null}
                {reader.metadata.last_verified ? (
                  <div className="flex justify-between gap-2">
                    <span>Verified</span>
                    <span className="font-medium text-foreground">{reader.metadata.last_verified}</span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2">
                  <span>Sources</span>
                  <span className="font-medium text-foreground">{reader.metadata.source_count ?? 0}</span>
                </div>
              </div>

              {reader.metadata.tags?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {reader.metadata.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              ) : null}

              {reader.metadata.keywords?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {reader.metadata.keywords.map((kw) => (
                    <Badge key={kw} variant="outline" className="text-xs">{kw}</Badge>
                  ))}
                </div>
              ) : null}

              {(() => {
                const nonImageFiles = reader.files.filter((f) => !f.mime_type.startsWith("image/"));
                if (!nonImageFiles.length) return null;
                return (
                  <div className="mt-4 space-y-0.5">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                      Attachments
                    </div>
                    {nonImageFiles.map((file) => (
                      <a
                        key={file.slug}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        href={file.download_url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span className="truncate">{file.name}</span>
                        <ArrowUpRight className="size-3.5 shrink-0" />
                      </a>
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : null}

          {reader?.related.length ? (
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                Related
              </div>
              <div className="space-y-0.5">
                {reader.related.map((item) => (
                  <button
                    key={item.slug}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => onNavigate(item.slug, sectionForPageType(item.type))}
                    type="button"
                  >
                    <div className="truncate font-medium text-foreground">{item.title}</div>
                    <div className="truncate text-xs opacity-60">{item.slug}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-start gap-2 text-xs text-muted-foreground/50">
            <Database className="mt-0.5 size-3.5 shrink-0 text-primary/50" />
            <span>Local-only. Served from Bun process.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
