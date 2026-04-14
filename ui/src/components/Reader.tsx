import { ChevronLeft, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { sectionEmptyHints } from "../constants";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type { CenterItem, ReaderPayload, Section } from "../types";

type PrevNext = { prev: CenterItem | null; next: CenterItem | null };

type Props = {
  reader: ReaderPayload | null;
  loadingReader: boolean;
  readerError: string | null;
  loadingItems: boolean;
  itemsError: string | null;
  itemsEmpty: boolean;
  currentItem: CenterItem | null;
  summaryText: string;
  renderedMarkdown: string;
  prevNextItems: PrevNext;
  section: Section;
  query: string;
  searchResultPicked: boolean;
  copyState: "idle" | "done" | "error";
  onBackToSearch: () => void;
  onSelectItem: (item: CenterItem) => void;
  onCopy: () => void;
  onImageClick: (src: string, alt: string) => void;
};

export function Reader({
  reader, loadingReader, readerError, loadingItems, itemsError, itemsEmpty,
  currentItem, summaryText, renderedMarkdown, prevNextItems, section, query,
  searchResultPicked, copyState, onBackToSearch, onSelectItem, onCopy, onImageClick,
}: Props) {
  return (
    <article className="w-full lg:max-w-[696px] lg:mx-auto xl:ml-[max(0px,calc(50vw-348px-18rem))] flex flex-col gap-6 px-5 py-8 xl:px-0 xl:py-10">
      {/* Back to search */}
      {query.trim() && searchResultPicked ? (
        <button
          className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onBackToSearch}
          type="button"
        >
          <ChevronLeft className="size-4" />
          Search results for "{query}"
        </button>
      ) : null}

      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{reader?.metadata.type ?? currentItem?.type ?? "Reader"}</Badge>
            {currentItem?.result_kind === "file" ? <Badge variant="outline">opened from file hit</Badge> : null}
            {currentItem?.has_files ? <Badge variant="secondary">has attachments</Badge> : null}
          </div>
          <Button onClick={onCopy} size="sm" variant="outline">
            <Copy className="size-4" />
            {copyState === "done" ? "Copied" : copyState === "error" ? "Clipboard blocked" : "Copy markdown"}
          </Button>
        </div>
        <div className="space-y-3">
          <h2 className="text-4xl font-semibold tracking-tight xl:text-5xl">
            {reader?.title ?? currentItem?.title ?? "Select a page"}
          </h2>
          {summaryText ? (
            <p
              className="max-w-3xl break-words text-base leading-8 text-muted-foreground"
              style={{ overflowWrap: "break-word", wordBreak: "break-word" }}
            >
              {summaryText}
            </p>
          ) : null}
        </div>
      </div>

      {/* Items error */}
      {itemsError ? (
        <Card className="border-red-200 bg-red-50/80 text-red-950">
          <CardContent className="p-5 text-sm leading-6">{itemsError}</CardContent>
        </Card>
      ) : null}

      {/* Items loading */}
      {!itemsError && loadingItems ? (
        <Card className="border-dashed bg-background/80">
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      ) : null}

      {/* Items empty */}
      {!itemsError && !loadingItems && itemsEmpty ? (
        <Card className="border-dashed bg-background/80">
          <CardHeader>
            <CardTitle>Nothing in this section yet</CardTitle>
            <CardDescription>{sectionEmptyHints[section]}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {/* Reader error */}
      {readerError ? (
        <Card className="border-red-200 bg-red-50/80 text-red-950">
          <CardContent className="p-5 text-sm leading-6">{readerError}</CardContent>
        </Card>
      ) : null}

      {/* Reader loading */}
      {!readerError && loadingReader ? (
        <Card className="border-dashed bg-background/80">
          <CardContent className="space-y-4 p-5">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[90%]" />
            <Skeleton className="h-4 w-[82%]" />
          </CardContent>
        </Card>
      ) : null}

      {/* Inline image for file items */}
      {!readerError && !loadingReader && !reader && currentItem?.type === "file" && currentItem.mime_type?.startsWith("image/") ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
            <img
              alt={currentItem.title}
              className="mx-auto max-h-[70vh] w-auto object-contain cursor-zoom-in"
              src={`/api/file/${currentItem.slug.replace("file:", "")}/raw`}
              onClick={() => onImageClick(
                `/api/file/${currentItem.slug.replace("file:", "")}/raw`,
                currentItem.title
              )}
            />
          </div>
          <p className="text-sm text-muted-foreground">{currentItem.title}</p>
        </div>
      ) : null}

      {/* Empty state */}
      {!readerError && !loadingReader && !reader &&
       !(currentItem?.type === "file" && currentItem.mime_type?.startsWith("image/")) ? (
        <Card className="border-dashed bg-background/80">
          <CardHeader>
            <CardTitle>Pick a page to start reading</CardTitle>
            <CardDescription>Select a page from the directory tree on the left.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {/* Markdown content */}
      {reader ? (
        <div className="space-y-6">
          <Separator />
          <div className="app-markdown">
            <MarkdownRenderer markdown={renderedMarkdown} onImageClick={onImageClick} />
          </div>

          {/* Image attachments gallery */}
          {(() => {
            const imageFiles = reader.files.filter((f) => f.mime_type.startsWith("image/"));
            if (!imageFiles.length) return null;
            return (
              <div className="space-y-3 border-t pt-6">
                <div className="text-sm font-semibold text-muted-foreground">Images</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {imageFiles.map((file) => (
                    <button
                      key={file.slug}
                      className="group overflow-hidden rounded-lg border border-border bg-muted/30 transition-colors hover:border-primary/40"
                      type="button"
                      onClick={() => onImageClick(file.download_url, file.name)}
                    >
                      <img
                        alt={file.name}
                        className="h-40 w-full object-cover transition-transform group-hover:scale-[1.02]"
                        loading="lazy"
                        src={file.download_url}
                      />
                      <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">{file.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Prev / Next navigation */}
          {(prevNextItems.prev || prevNextItems.next) && (
            <div className="flex items-stretch justify-between gap-4 border-t pt-6">
              {prevNextItems.prev ? (
                <button
                  className="flex flex-1 flex-col gap-1 rounded-xl border bg-background/80 px-4 py-3 text-left transition-colors hover:bg-muted/60"
                  onClick={() => onSelectItem(prevNextItems.prev!)}
                  type="button"
                >
                  <span className="text-xs text-muted-foreground">← Previous</span>
                  <span className="line-clamp-2 text-sm font-medium">{prevNextItems.prev.title}</span>
                </button>
              ) : <div className="flex-1" />}
              {prevNextItems.next ? (
                <button
                  className="flex flex-1 flex-col gap-1 rounded-xl border bg-background/80 px-4 py-3 text-right transition-colors hover:bg-muted/60"
                  onClick={() => onSelectItem(prevNextItems.next!)}
                  type="button"
                >
                  <span className="text-xs text-muted-foreground">Next →</span>
                  <span className="line-clamp-2 text-sm font-medium">{prevNextItems.next.title}</span>
                </button>
              ) : <div className="flex-1" />}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}
