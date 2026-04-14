import { useEffect, useState } from "react";

export type LightboxState = { src: string; alt: string } | null;

export function useLightbox() {
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const open = (src: string, alt: string) => setLightbox({ src, alt });
  const close = () => setLightbox(null);

  return { lightbox, open, close };
}
