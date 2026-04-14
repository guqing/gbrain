import { useEffect, useState } from "react";
import type { CenterItem, SearchResponse, Section, SearchScope } from "../types";

export function useItems(query: string, searchScope: SearchScope, section: Section) {
  const [items, setItems] = useState<CenterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      setWarning(null);
      setHasMore(false);

      try {
        if (query.trim()) {
          const params = new URLSearchParams({ q: query.trim(), scope: searchScope, limit: "40" });
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
        if (!cancelled) {
          setItems(payload);
          setHasMore(payload.length === 50);
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setItems([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timer = window.setTimeout(load, query.trim() ? 180 : 0);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, searchScope, section]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || query.trim()) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ section, limit: "50", offset: String(items.length) });
      const response = await fetch(`/api/pages?${params.toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as CenterItem[];
      setItems((prev) => [...prev, ...payload]);
      setHasMore(payload.length === 50);
    } catch {
      // ignore; user can retry
    } finally {
      setLoadingMore(false);
    }
  };

  return { items, setItems, loading, error, warning, hasMore, loadingMore, loadMore };
}
