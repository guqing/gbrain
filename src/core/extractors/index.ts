/**
 * ExtractorRegistry — maps MIME types to ContentExtractor implementations.
 *
 * Registration order matters: first matching extractor wins.
 */

import type { ContentExtractor } from "./interface.ts";
import { PdfExtractor } from "./pdf.ts";
import { DocumentExtractor } from "./document.ts";
import { AudioExtractor } from "./audio.ts";
import { VideoExtractor } from "./video.ts";
import { ImageExtractor } from "./image.ts";

class ExtractorRegistry {
  private extractors: ContentExtractor[] = [];

  register(extractor: ContentExtractor): void {
    this.extractors.push(extractor);
  }

  /** Returns the first extractor that supports this MIME type, or null. */
  get(mimeType: string): ContentExtractor | null {
    return this.extractors.find(e => e.supports(mimeType)) ?? null;
  }

  supports(mimeType: string): boolean {
    return this.extractors.some(e => e.supports(mimeType));
  }
}

export const registry = new ExtractorRegistry();

// Register all built-in extractors (order: specific → general)
registry.register(new PdfExtractor());
registry.register(new DocumentExtractor());
registry.register(new AudioExtractor());
registry.register(new VideoExtractor());
registry.register(new ImageExtractor());

export { ExtractorRegistry };
