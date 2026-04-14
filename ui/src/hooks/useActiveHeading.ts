import { useEffect, useState } from "react";
import type { Heading } from "../types";

export function useActiveHeading(headings: Heading[], readerSlug: string | undefined) {
  const [activeHeading, setActiveHeading] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) {
      setActiveHeading(null);
      return;
    }

    setActiveHeading(headings[0]?.id ?? null);
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveHeading(visible[0].target.id);
      },
      { root: null, rootMargin: "-10% 0px -60% 0px", threshold: [0, 1] }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings, readerSlug]);

  return activeHeading;
}
