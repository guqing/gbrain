import { X } from "lucide-react";
import type { LightboxState } from "../hooks/useLightbox";

type Props = {
  lightbox: LightboxState;
  onClose: () => void;
};

export function Lightbox({ lightbox, onClose }: Props) {
  if (!lightbox) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        type="button"
        aria-label="Close"
        onClick={onClose}
      >
        <X className="size-5" />
      </button>
      <img
        alt={lightbox.alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        src={lightbox.src}
        onClick={(e) => e.stopPropagation()}
      />
      {lightbox.alt && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-3 py-1.5 text-sm text-white">
          {lightbox.alt}
        </div>
      )}
    </div>
  );
}
