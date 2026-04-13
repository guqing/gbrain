import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BrainCircuit,
  Copy,
  Database,
  FileText,
  Folder,
  FolderOpen,
  Paperclip,
  Search,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Section = "recent" | "concept" | "session" | "inbox" | "file";
type SearchScope = "all" | "pages" | "sessions" | "files";

type CenterItem = {
  slug: string;
  title: string;
  type: string;
  updated_at: string;
  has_files: boolean;
  preview: string;
  score?: number;
  chunk_text?: string;
  result_kind?: "page" | "file";
  parent_page_slug?: string | null;
  mime_type?: string;
};

type SearchResponse = {
  results: Array<{
    slug: string;
    title: string;
    type: string;
    score: number;
    chunk_text: string;
    result_kind?: "page" | "file";
    parent_page_slug?: string;
  }>;
  degraded: boolean;
  warning: string | null;
};

type UISummary = {
  total_pages: number;
  total_files: number;
  embedded_pages: number;
  vector_enabled: boolean;
  collections: Record<Section, number>;
};

type ReaderPayload = {
  slug: string;
  title: string;
  markdown: string;
  metadata: {
    type: string;
    updated_at: string;
    tags?: string[];
    has_files: boolean;
    confidence?: number | null;
    last_verified?: string | null;
    source_count?: number;
  };
  files: Array<{
    slug: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    download_url: string;
  }>;
  related: Array<{
    slug: string;
    title: string;
    type: string;
  }>;
};

type Heading = {
  id: string;
  text: string;
  level: number;
};

type TreeNode =
  | {
      kind: "branch";
      id: string;
      label: string;
      children: TreeNode[];
    }
  | {
      kind: "leaf";
      id: string;
      label: string;
      item: CenterItem;
    };

const sectionLabels: Record<Section, string> = {
  recent: "Recent",
  concept: "Concepts",
  session: "Sessions",
  inbox: "Inbox",
  file: "Files",
};

const searchScopeLabels: Record<SearchScope, string> = {
  all: "All",
  pages: "Pages",
  sessions: "Sessions",
  files: "Files",
};

const sectionRoots: Partial<Record<Section, string>> = {
  concept: "concepts",
  session: "sessions",
  inbox: "inbox",
  file: "files",
};

const sectionEmptyHints: Record<Section, string> = {
  recent: "No pages yet. Run `exo ingest` to import your first ChatGPT export or document.",
  concept: "No concept pages yet. Concept pages live under `concepts/` in your knowledge base.",
  session: "No session pages yet. Session pages live under `sessions/` in your knowledge base.",
  inbox: "Inbox is empty. Pages pending compilation appear here after ingestion.",
  file: "No files yet. Attach files with `exo attach` or during ingestion.",
};

function parseSection(value: string | null): Section {
  if (value === "concept" || value === "session" || value === "inbox" || value === "file") return value;
  return "recent";
}

function parseSearchScope(value: string | null): SearchScope {
  if (value === "pages" || value === "sessions" || value === "files") return value;
  return "all";
}

function sectionForPageType(value: string): Section {
  if (value === "concept" || value === "session" || value === "inbox" || value === "file") return value;
  return "recent";
}

function buildUrl(section: Section, slug: string | null, query: string, scope: SearchScope): string {
  const params = new URLSearchParams();
  params.set("section", section);
  if (slug) params.set("slug", slug);
  if (query.trim()) params.set("q", query.trim());
  if (scope !== "all") params.set("scope", scope);
  return `/?${params.toString()}`;
}

function resolveReaderSlug(item: CenterItem): string | null {
  return item.result_kind === "file" || item.type === "file" ? item.parent_page_slug ?? null : item.slug;
}

function formatUpdatedAt(value: string): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();

  markdown.split("\n").forEach((line) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (!match) return;
    const text = match[2]!.trim();
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    headings.push({
      id: count === 0 ? base : `${base}-${count + 1}`,
      text,
      level: match[1]!.length,
    });
  });

  return headings;
}

function firstParagraph(markdown: string): string {
  return markdown
    .split("\n\n")
    .map((block) => block.replace(/^#+\s+/gm, "").trim())
    .find((block) => block.length > 0) ?? "";
}

function stripLeadingTitle(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  const firstLine = lines[0]?.trim();
  if (firstLine === `# ${title}`) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return markdown;
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return nodeText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function prettifySegment(segment: string): string {
  return segment.replace(/^file:/, "").replace(/[-_]/g, " ");
}

function treeSegmentsForItem(item: CenterItem, section: Section, query: string): string[] {
  if (item.type === "file") return [item.title];

  const source = item.parent_page_slug ?? item.slug;
  let segments = source.split("/").filter(Boolean);
  const root = sectionRoots[section];

  if (!query.trim() && root && segments[0] === root && segments.length > 1) {
    segments = segments.slice(1);
  }

  if (segments.length <= 1) return [item.title];
  return [...segments.slice(0, -1).map(prettifySegment), item.title];
}

function buildTree(items: CenterItem[], section: Section, query: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const branches = new Map<string, TreeNode & { kind: "branch" }>();

  const ensureBranch = (id: string, label: string, parent: Array<TreeNode>) => {
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
        level.push({
          kind: "leaf",
          id: `${item.slug}:${index}`,
          label: segment,
          item,
        });
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

export function App() {
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const readerScrollRef = useRef<HTMLElement>(null);
  const [section, setSection] = useState<Section>(parseSection(initialParams.get("section")));
  const [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [searchScope, setSearchScope] = useState<SearchScope>(parseSearchScope(initialParams.get("scope")));
  const [items, setItems] = useState<CenterItem[]>([]);
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(initialParams.get("slug"));
  const [selectedReaderSlug, setSelectedReaderSlug] = useState<string | null>(initialParams.get("slug"));
  const [reader, setReader] = useState<ReaderPayload | null>(null);
  const [summary, setSummary] = useState<UISummary | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingReader, setLoadingReader] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const [activeHeading, setActiveHeading] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setSection(parseSection(params.get("section")));
      setQuery(params.get("q") ?? "");
      setSearchScope(parseSearchScope(params.get("scope")));
      setSelectedItemKey(params.get("slug"));
      setSelectedReaderSlug(params.get("slug"));
      setCollapsed({});
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    window.history.replaceState(null, "", buildUrl(section, selectedReaderSlug, query, searchScope));
  }, [query, searchScope, section, selectedReaderSlug]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadSummary = async () => {
      try {
        const response = await fetch("/api/summary", { signal: controller.signal });
        if (!response.ok) throw new Error(`Summary failed with HTTP ${response.status}`);
        const payload = (await response.json()) as UISummary;
        if (!cancelled) setSummary(payload);
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          setSummary(null);
        }
      }
    };

    void loadSummary();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadItems = async () => {
      setLoadingItems(true);
      setItemsError(null);
      setWarning(null);

      try {
        if (query.trim()) {
          const params = new URLSearchParams({
            q: query.trim(),
            scope: searchScope,
            limit: "40",
          });
          const response = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
          if (!response.ok) throw new Error(`Search failed with HTTP ${response.status}`);
          const payload = (await response.json()) as SearchResponse;
          if (cancelled) return;

          setWarning(payload.warning);
          setItems(
            payload.results.map((result) => ({
              slug: result.slug,
              title: result.title || result.slug,
              type: result.result_kind === "file" ? "file" : result.type,
              updated_at: "",
              has_files: result.result_kind === "file",
              preview: result.chunk_text,
              chunk_text: result.chunk_text,
              score: result.score,
              result_kind: result.result_kind,
              parent_page_slug: result.parent_page_slug ?? null,
            }))
          );
          return;
        }

        const params = new URLSearchParams({ section, limit: "50", offset: "0" });
        const response = await fetch(`/api/pages?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Browse failed with HTTP ${response.status}`);
        const payload = (await response.json()) as CenterItem[];
        if (!cancelled) setItems(payload);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setItems([]);
        setItemsError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    };

    const timer = window.setTimeout(loadItems, query.trim() ? 180 : 0);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, searchScope, section]);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedItemKey(null);
      setSelectedReaderSlug(null);
      return;
    }

    const byItemKey = selectedItemKey ? items.find((item) => item.slug === selectedItemKey) : null;
    const byReaderSlug = selectedReaderSlug ? items.find((item) => resolveReaderSlug(item) === selectedReaderSlug) : null;
    const next = byItemKey ?? byReaderSlug ?? items[0]!;
    const nextReaderSlug = resolveReaderSlug(next);

    if (selectedItemKey !== next.slug) setSelectedItemKey(next.slug);
    if (selectedReaderSlug !== nextReaderSlug) setSelectedReaderSlug(nextReaderSlug);
  }, [items, selectedItemKey, selectedReaderSlug]);

  useEffect(() => {
    if (!selectedReaderSlug) {
      setReader(null);
      setReaderError(
        selectedItemKey && items.find((item) => item.slug === selectedItemKey)?.type === "file"
          ? "This file is not attached to a page yet."
          : null
      );
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadReader = async () => {
      setLoadingReader(true);
      setReaderError(null);

      try {
        const response = await fetch(`/api/page/${encodeURIComponent(selectedReaderSlug)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Reader failed with HTTP ${response.status}`);
        const payload = (await response.json()) as ReaderPayload;
        if (!cancelled) setReader(payload);
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setReader(null);
          setReaderError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setLoadingReader(false);
      }
    };

    void loadReader();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [items, selectedItemKey, selectedReaderSlug]);

  const currentItem = useMemo(
    () =>
      items.find((item) => item.slug === selectedItemKey) ??
      items.find((item) => resolveReaderSlug(item) === selectedReaderSlug) ??
      null,
    [items, selectedItemKey, selectedReaderSlug]
  );

  const contentItems = useMemo(() => items.filter((item) => item.slug !== currentItem?.slug), [items, currentItem]);
  const renderedMarkdown = useMemo(() => (reader ? stripLeadingTitle(reader.markdown, reader.title) : ""), [reader]);
  const headings = useMemo(() => extractHeadings(renderedMarkdown), [renderedMarkdown]);
  const tree = useMemo(() => buildTree(items, section, query), [items, query, section]);
  const summaryText = currentItem?.chunk_text ?? currentItem?.preview ?? (reader ? firstParagraph(renderedMarkdown) : "");
  const currentTreePath = useMemo(() => {
    if (!currentItem) return [];
    return treeSegmentsForItem(currentItem, section, query).slice(0, -1);
  }, [currentItem, query, section]);
  useEffect(() => {
    if (currentTreePath.length === 0) return;
    setCollapsed((prev) => {
      const next = { ...prev };
      let branch = "";
      currentTreePath.forEach((segment) => {
        branch = branch ? `${branch}/${segment}` : segment;
        delete next[branch];
      });
      return next;
    });
  }, [currentTreePath]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1400);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (!readerScrollRef.current) return;
    const viewport = readerScrollRef.current.closest("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    if (viewport) viewport.scrollTop = 0;
  }, [selectedReaderSlug]);

  useEffect(() => {
    if (headings.length === 0) {
      setActiveHeading(null);
      return;
    }

    setActiveHeading(headings[0]?.id ?? null);
    const elements = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => Boolean(element));

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveHeading(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 1] }
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [headings, reader?.slug]);

  const selectItem = (item: CenterItem) => {
    setSelectedItemKey(item.slug);
    setSelectedReaderSlug(resolveReaderSlug(item));
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

  const renderTreeNodes = (nodes: TreeNode[], depth = 0) =>
    nodes.map((node) => {
      if (node.kind === "leaf") {
        const active = node.item.slug === selectedItemKey || resolveReaderSlug(node.item) === selectedReaderSlug;
        return (
          <button
            key={node.id}
            className={cn(
              "flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 text-left text-[15px] transition-colors",
              active ? "bg-primary/[0.08] text-foreground" : "text-muted-foreground hover:bg-muted/55 hover:text-foreground"
            )}
            onClick={() => selectItem(node.item)}
            style={{ paddingLeft: `${depth * 20 + 10}px` }}
            type="button"
          >
            {node.item.type === "file" ? (
              <Paperclip className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
            ) : (
              <FileText className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
            )}
            <span className={cn("truncate", active ? "font-medium" : "")}>{node.label}</span>
          </button>
        );
      }

      const isCollapsed = collapsed[node.id] ?? false;
      const inCurrentPath = currentTreePath.join("/").startsWith(node.id);

      return (
        <div className="space-y-1" key={node.id}>
          <button
            className={cn(
              "flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 text-left text-[15px] transition-colors",
              inCurrentPath ? "bg-muted/65 text-foreground" : "text-muted-foreground hover:bg-muted/55 hover:text-foreground"
            )}
            onClick={() => setCollapsed((prev) => ({ ...prev, [node.id]: !isCollapsed }))}
            style={{ paddingLeft: `${depth * 20 + 10}px` }}
            type="button"
          >
            {isCollapsed ? (
              <Folder className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate font-medium">{node.label}</span>
          </button>
          {!isCollapsed ? <div className="space-y-1">{renderTreeNodes(node.children, depth + 1)}</div> : null}
        </div>
      );
    });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-sidebar/95 xl:border-b-0 xl:border-r">
          <div className="flex h-full min-h-0 flex-col">
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

              <div className="mt-4 rounded-xl border bg-background/90 p-3 shadow-xs">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Quick search</span>
                  <Badge variant="outline">Cmd/Ctrl + K</Badge>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-11 rounded-lg border-0 bg-muted pl-9 shadow-none focus-visible:ring-2"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search pages, files, ideas..."
                    ref={searchInputRef}
                    value={query}
                  />
                </div>
              </div>

              {query.trim() ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(Object.keys(searchScopeLabels) as SearchScope[]).map((scope) => (
                    <button
                      key={scope}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        searchScope === scope
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                      )}
                      onClick={() => setSearchScope(scope)}
                      type="button"
                    >
                      {searchScopeLabels[scope]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <ScrollArea className="flex-1 px-4 pb-6">
              <div className="space-y-6 pb-2">
                <div className="space-y-3">
                  <div className="px-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Browse</div>
                  <div className="space-y-1">
                    {(Object.keys(sectionLabels) as Section[]).map((entry) => (
                      <button
                        key={entry}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left transition-colors",
                          entry === section ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                        onClick={() => {
                          setSection(entry);
                          setQuery("");
                          setCollapsed({});
                        }}
                        type="button"
                      >
                        <span className="font-medium">{sectionLabels[entry]}</span>
                        <span className="text-xs text-muted-foreground">{summary?.collections[entry] ?? "—"}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between px-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {query.trim() ? "Matching paths" : "Directory structure"}
                    </div>
                    <Badge variant="muted">{query.trim() ? searchScopeLabels[searchScope] : sectionLabels[section]}</Badge>
                  </div>
                  <div className="space-y-1">{renderTreeNodes(tree)}</div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="grid min-h-screen xl:grid-cols-[minmax(0,1fr)_320px]">
            <ScrollArea className="min-h-0">
              <article ref={readerScrollRef} className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-8 xl:px-8 xl:py-10">
                {warning ? (
                  <Card className="max-w-xl border-amber-200 bg-amber-50/80 text-amber-950 shadow-none">
                    <CardContent className="flex items-start gap-3 p-4">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <p className="text-sm leading-6">{warning}</p>
                    </CardContent>
                  </Card>
                ) : null}

                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{reader?.metadata.type ?? currentItem?.type ?? "Reader"}</Badge>
                      {currentItem?.result_kind === "file" ? <Badge variant="outline">opened from file hit</Badge> : null}
                      {currentItem?.has_files ? <Badge variant="secondary">has attachments</Badge> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button onClick={copyPage} size="sm" variant="outline">
                        <Copy className="size-4" />
                        {copyState === "done" ? "Copied" : copyState === "error" ? "Clipboard blocked" : "Copy markdown"}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h2 className="text-4xl font-semibold tracking-tight xl:text-5xl">
                      {reader?.title ?? currentItem?.title ?? "Select a page"}
                    </h2>
                    {summaryText ? <p className="max-w-3xl text-base leading-8 text-muted-foreground">{summaryText}</p> : null}
                  </div>
                </div>

                {itemsError ? (
                  <Card className="border-red-200 bg-red-50/80 text-red-950">
                    <CardContent className="p-5 text-sm leading-6">{itemsError}</CardContent>
                  </Card>
                ) : null}

                {!itemsError && loadingItems ? (
                  <Card className="border-dashed bg-background/80">
                    <CardContent className="space-y-3 p-5">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ) : null}

                {!itemsError && !loadingItems && items.length === 0 ? (
                  <Card className="border-dashed bg-background/80">
                    <CardHeader>
                      <CardTitle>{query.trim() ? "No matching results" : "Nothing in this section yet"}</CardTitle>
                      <CardDescription>
                        {query.trim()
                          ? "Try a narrower query, or switch the scope above."
                          : sectionEmptyHints[section]}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ) : null}

                {!itemsError && !loadingItems && contentItems.length > 0 ? (
                  <Card className="overflow-hidden border-dashed bg-background/80">
                    <CardHeader className="pb-4">
                      <CardTitle>{query.trim() ? `More results for "${query}"` : `More in ${sectionLabels[section]}`}</CardTitle>
                      <CardDescription>
                        {query.trim()
                          ? "Click any result to open it in the reader above."
                          : `All pages in ${sectionLabels[section]}.`}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-0 p-0">
                      {contentItems.map((item, index) => (
                        <button
                          key={`${item.slug}:${item.score ?? ""}`}
                          className={cn(
                            "flex w-full flex-col gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/60",
                            index > 0 ? "border-t" : ""
                          )}
                          onClick={() => selectItem(item)}
                          type="button"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="muted">{item.type}</Badge>
                              {item.has_files ? <Badge variant="outline">attachments</Badge> : null}
                              {item.mime_type ? <Badge variant="outline">{item.mime_type}</Badge> : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              {item.updated_at ? <span>{formatUpdatedAt(item.updated_at)}</span> : <span>{item.result_kind === "file" ? "file hit" : "page"}</span>}
                              {item.score !== undefined ? <span>score {item.score.toFixed(3)}</span> : null}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="text-base font-semibold">{item.title}</div>
                            <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{item.chunk_text ?? item.preview}</p>
                          </div>
                        </button>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                {readerError ? (
                  <Card className="border-red-200 bg-red-50/80 text-red-950">
                    <CardContent className="p-5 text-sm leading-6">{readerError}</CardContent>
                  </Card>
                ) : null}

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

                {!readerError && !loadingReader && !reader ? (
                  <Card className="border-dashed bg-background/80">
                    <CardHeader>
                      <CardTitle>Pick a page to start reading</CardTitle>
                      <CardDescription>
                        Select a page from the directory tree on the left.
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ) : null}

                {reader ? (
                  <div className="space-y-6">
                    <Separator />
                    <div className="app-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => <h1 id={slugify(nodeText(children))}>{children}</h1>,
                          h2: ({ children }) => <h2 id={slugify(nodeText(children))}>{children}</h2>,
                          h3: ({ children }) => <h3 id={slugify(nodeText(children))}>{children}</h3>,
                        }}
                      >
                        {renderedMarkdown}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : null}
              </article>
            </ScrollArea>

            <ScrollArea className="bg-transparent">
              <aside className="flex h-full flex-col gap-4 px-5 py-8 xl:px-5 xl:py-10">
                <Card className="border-0 bg-muted/35 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">On this page</CardTitle>
                    <CardDescription>Jump through the current markdown structure.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {headings.length === 0 ? (
                      <p className="text-sm leading-6 text-muted-foreground">No headings yet.</p>
                    ) : (
                      headings.map((heading) => (
                        <a
                          className={cn(
                            "block rounded-lg px-3 py-2 text-sm transition-colors",
                            activeHeading === heading.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                          href={`#${heading.id}`}
                          key={heading.id}
                          style={{ paddingLeft: `${heading.level * 10}px` }}
                        >
                          {heading.text}
                        </a>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="border-0 bg-muted/35 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Page details</CardTitle>
                    <CardDescription>Metadata, provenance, and attached files.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {reader ? (
                      <>
                        <div className="space-y-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Updated</span>
                            <span className="font-medium">{formatUpdatedAt(reader.metadata.updated_at)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Confidence</span>
                            <span className="font-medium">{reader.metadata.confidence ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Last verified</span>
                            <span className="font-medium">{reader.metadata.last_verified ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Sources</span>
                            <span className="font-medium">{reader.metadata.source_count ?? 0}</span>
                          </div>
                        </div>

                        {reader.metadata.tags?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {reader.metadata.tags.map((tag) => (
                              <Badge key={tag} variant="secondary">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : null}

                        {reader.files.length ? (
                          <div className="space-y-3">
                            <Separator />
                            {reader.files.map((file) => (
                              <div className="space-y-2" key={file.slug}>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium">{file.name}</div>
                                    <div className="text-xs text-muted-foreground">{file.mime_type}</div>
                                  </div>
                                  <div className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size_bytes)}</div>
                                </div>
                                <a
                                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full justify-between")}
                                  href={file.download_url}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  Open attachment
                                  <ArrowUpRight className="size-4" />
                                </a>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm leading-6 text-muted-foreground">Open a page to see metadata and attachments.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-0 bg-muted/35 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Related</CardTitle>
                    <CardDescription>Follow outgoing links and backlinks from the current page.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {reader?.related.length ? (
                      reader.related.map((item) => (
                        <button
                          className="flex w-full items-start justify-between gap-3 rounded-xl border bg-background px-3 py-3 text-left transition-colors hover:bg-muted"
                          key={item.slug}
                          onClick={() => {
                            setSection(sectionForPageType(item.type));
                            setQuery("");
                            setSelectedItemKey(item.slug);
                            setSelectedReaderSlug(item.slug);
                          }}
                          type="button"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="truncate text-sm font-medium">{item.title}</div>
                            <div className="truncate text-xs text-muted-foreground">{item.slug}</div>
                          </div>
                          <Badge variant="outline">{item.type}</Badge>
                        </button>
                      ))
                    ) : (
                      <p className="text-sm leading-6 text-muted-foreground">No linked pages yet.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-0 bg-transparent shadow-none">
                  <CardContent className="flex items-start gap-3 p-5 text-sm leading-6 text-muted-foreground">
                    <Database className="mt-0.5 size-4 shrink-0 text-primary" />
                    The UI stays local. Bun serves the browser shell and the `/api/*` endpoints from the same process.
                  </CardContent>
                </Card>
              </aside>
            </ScrollArea>
          </div>
        </main>
      </div>
    </div>
  );
}
