import { useEffect, useState } from "react";
import type { CenterItem, ReaderPayload } from "../types";

export function useReader(
  selectedReaderSlug: string | null,
  selectedItemKey: string | null,
  items: CenterItem[]
) {
  const [reader, setReader] = useState<ReaderPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedReaderSlug) {
      setReader(null);
      const selectedItem = selectedItemKey ? items.find((item) => item.slug === selectedItemKey) : null;
      setError(selectedItem?.type === "file" ? "This file is not attached to a page yet." : null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/page/${encodeURIComponent(selectedReaderSlug)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Reader failed with HTTP ${response.status}`);
        const payload = (await response.json()) as ReaderPayload;
        if (!cancelled) setReader(payload);
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          setReader(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [items, selectedItemKey, selectedReaderSlug]);

  return { reader, loading, error };
}
