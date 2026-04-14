import { useEffect, useState } from "react";
import type { UISummary } from "../types";

export function useSummary() {
  const [summary, setSummary] = useState<UISummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch("/api/summary", { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as UISummary;
        if (!cancelled) setSummary(payload);
      } catch {
        if (!cancelled && !controller.signal.aborted) setSummary(null);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return summary;
}
