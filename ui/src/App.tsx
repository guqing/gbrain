import { useEffect, useMemo, useRef, useState } from "react";
import { sectionForPageType } from "./lib/url";
import { extractHeadings, stripLeadingTitle, firstParagraph, stripMarkdownSyntax, stripFrontmatter } from "./lib/markdown";
import { resolveReaderSlug, treeSegmentsForItem, buildTree } from "./lib/tree";
import { useUrlSync } from "./hooks/useUrlSync";
import { useItems } from "./hooks/useItems";
import { useReader } from "./hooks/useReader";
import { useSummary } from "./hooks/useSummary";
import { useActiveHeading } from "./hooks/useActiveHeading";
import { useLightbox } from "./hooks/useLightbox";
import { Sidebar } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { Reader } from "./components/Reader";
import { TocSidebar } from "./components/TocSidebar";
import { FilesGallery } from "./components/FilesGallery";
import { Lightbox } from "./components/Lightbox";
import type { CenterItem, Section } from "./types";

export function App() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const readerScrollRef = useRef<HTMLDivElement>(null);

  const {
    section, setSection,
    query, setQuery,
    searchScope, setSearchScope,
    selectedItemKey, setSelectedItemKey,
    selectedReaderSlug, setSelectedReaderSlug,
  } = useUrlSync();

  const summary = useSummary();
  const { items, loading: loadingItems, error: itemsError, warning, hasMore, loadingMore, loadMore } = useItems(query, searchScope, section);
  const { reader, loading: loadingReader, error: readerError } = useReader(selectedReaderSlug, selectedItemKey, items);
  const { lightbox, open: openLightbox, close: closeLightbox } = useLightbox();

  const [searchResultPicked, setSearchResultPicked] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");

  // Cmd+K shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Clear selection when query changes
  useEffect(() => {
    if (query.trim()) {
      setSelectedItemKey(null);
      setSelectedReaderSlug(null);
      setSearchResultPicked(false);
    }
  }, [query, searchScope]);

  // Auto-select first item
  useEffect(() => {
    if (query.trim() && !searchResultPicked) return;
    if (items.length === 0) {
      setSelectedItemKey(null);
      setSelectedReaderSlug(null);
      return;
    }
    const byItemKey = selectedItemKey ? items.find((i) => i.slug === selectedItemKey) : null;
    const byReaderSlug = selectedReaderSlug ? items.find((i) => resolveReaderSlug(i) === selectedReaderSlug) : null;
    const next = byItemKey ?? byReaderSlug ?? items[0]!;
    const nextReaderSlug = resolveReaderSlug(next);
    if (selectedItemKey !== next.slug) setSelectedItemKey(next.slug);
    if (selectedReaderSlug !== nextReaderSlug) setSelectedReaderSlug(nextReaderSlug);
  }, [items, selectedItemKey, selectedReaderSlug, query, searchResultPicked]);

  // Scroll to top when reader changes
  useEffect(() => {
    if (readerScrollRef.current) window.scrollTo({ top: 0 });
  }, [selectedReaderSlug]);

  // Copy state reset
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1400);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  // Derived values
  const renderedMarkdown = useMemo(() => (reader ? stripLeadingTitle(reader.markdown, reader.title) : ""), [reader]);
  const headings = useMemo(() => extractHeadings(renderedMarkdown), [renderedMarkdown]);
  const tree = useMemo(() => buildTree(items, section, query), [items, section, query]);

  const currentItem = useMemo(
    () => items.find((i) => i.slug === selectedItemKey) ?? items.find((i) => resolveReaderSlug(i) === selectedReaderSlug) ?? null,
    [items, selectedItemKey, selectedReaderSlug]
  );

  const prevNextItems = useMemo(() => {
    if (!currentItem) return { prev: null, next: null };
    const idx = items.findIndex((i) => i.slug === currentItem.slug);
    return { prev: idx > 0 ? items[idx - 1]! : null, next: idx < items.length - 1 ? items[idx + 1]! : null };
  }, [items, currentItem]);

  const summaryText = useMemo(() => {
    if (reader) return firstParagraph(renderedMarkdown);
    const raw = currentItem?.chunk_text ?? currentItem?.preview ?? "";
    return stripMarkdownSyntax(stripFrontmatter(raw));
  }, [currentItem, reader, renderedMarkdown]);

  const currentTreePath = useMemo(() => {
    if (!currentItem) return [];
    return treeSegmentsForItem(currentItem, section, query).slice(0, -1);
  }, [currentItem, section, query]);

  // Auto-expand tree path
  useEffect(() => {
    if (currentTreePath.length === 0) return;
    setCollapsed((prev) => {
      const next = { ...prev };
      let branch = "";
      currentTreePath.forEach((segment) => {
        branch = branch ? `${branch}/${segment}` : segment;
        next[branch] = false;
      });
      return next;
    });
  }, [currentTreePath]);

  const activeHeading = useActiveHeading(headings, reader?.slug);

  const selectItem = (item: CenterItem) => {
    setSelectedItemKey(item.slug);
    setSelectedReaderSlug(resolveReaderSlug(item));
    if (query.trim()) setSearchResultPicked(true);
    if ((item.type === "file" || item.result_kind === "file") && item.mime_type?.startsWith("image/")) {
      const fileSlug = item.slug.replace("file:", "");
      openLightbox(`/api/file/${encodeURIComponent(fileSlug)}/raw`, item.title);
      setTimeout(() => {
        document.getElementById(`gc-${item.slug}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }
  };

  const handleNavigate = (slug: string, targetSection: Section) => {
    setSection(targetSection);
    setQuery("");
    setSelectedItemKey(slug);
    setSelectedReaderSlug(slug);
  };

  const copyPage = async () => {
    if (!reader) return;
    try {
      await navigator.clipboard.writeText(reader.markdown);
      setCopyState("done");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen xl:grid-cols-[320px_minmax(0,1fr)]">
        <Sidebar
          section={section}
          query={query}
          searchScope={searchScope}
          tree={tree}
          selectedItemKey={selectedItemKey}
          selectedReaderSlug={selectedReaderSlug}
          collapsed={collapsed}
          currentTreePath={currentTreePath}
          summary={summary}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onSectionChange={(s) => { setSection(s); setQuery(""); setCollapsed({}); }}
          onSelect={selectItem}
          onToggle={(id) => setCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }))}
          onLoadMore={loadMore}
        />

        <main className="min-w-0">
          <SearchBar
            query={query}
            searchScope={searchScope}
            inputRef={searchInputRef}
            onQueryChange={setQuery}
            onScopeChange={setSearchScope}
            onClear={() => { setQuery(""); setSearchResultPicked(false); setSelectedItemKey(null); setSelectedReaderSlug(null); }}
          />

          {query.trim() && !searchResultPicked ? (
            <SearchResults
              query={query}
              items={items}
              loading={loadingItems}
              error={itemsError}
              warning={warning}
              onSelect={selectItem}
            />
          ) : (
            <div className="flex min-h-0">
              {section === "file" && !query.trim() ? (
                <FilesGallery
                  items={items}
                  loading={loadingItems}
                  selectedItemKey={selectedItemKey}
                  summary={summary}
                  section={section}
                  onLightbox={openLightbox}
                  onNavigatePage={(slug) => {
                    setSection(sectionForPageType("session"));
                    setQuery("");
                    setSelectedItemKey(slug);
                    setSelectedReaderSlug(slug);
                  }}
                />
              ) : (
                <>
                  <div ref={readerScrollRef} className="flex-1 min-w-0">
                    <Reader
                      reader={reader}
                      loadingReader={loadingReader}
                      readerError={readerError}
                      loadingItems={loadingItems}
                      itemsError={itemsError}
                      itemsEmpty={!loadingItems && !itemsError && items.length === 0}
                      currentItem={currentItem}
                      summaryText={summaryText}
                      renderedMarkdown={renderedMarkdown}
                      prevNextItems={prevNextItems}
                      section={section}
                      query={query}
                      searchResultPicked={searchResultPicked}
                      copyState={copyState}
                      onBackToSearch={() => { setSearchResultPicked(false); setSelectedItemKey(null); setSelectedReaderSlug(null); }}
                      onSelectItem={selectItem}
                      onCopy={copyPage}
                      onImageClick={openLightbox}
                    />
                  </div>
                  <TocSidebar
                    headings={headings}
                    activeHeading={activeHeading}
                    reader={reader}
                    onNavigate={handleNavigate}
                  />
                </>
              )}
            </div>
          )}
        </main>
      </div>
      <Lightbox lightbox={lightbox} onClose={closeLightbox} />
    </div>
  );
}
