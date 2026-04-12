import { readFile } from "node:fs/promises";
import type { ContentChunk, ContentExtractor, ExtractOpts } from "./interface.ts";
import type { VisionConfig } from "../vision.ts";
import { describeImage } from "../vision.ts";
import { isImageMime } from "../files.ts";

export interface ImageExtractOpts extends ExtractOpts {
  visionConfig: VisionConfig;
}

export class ImageExtractor implements ContentExtractor {
  supports(mimeType: string): boolean {
    return isImageMime(mimeType);
  }

  async extract(filePath: string, opts?: ExtractOpts): Promise<ContentChunk[]> {
    const imageOpts = opts as ImageExtractOpts | undefined;
    const visionConfig = imageOpts?.visionConfig;
    if (!visionConfig) {
      throw new Error("ImageExtractor requires opts.visionConfig");
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(filePath);
    } catch (err) {
      throw new Error(`Failed to read image at ${filePath}: ${(err as Error).message}`);
    }

    // Infer MIME type from path extension if needed — extractor is called
    // with the stored mime_type from the files table.
    const mimeType = filePath.match(/\.(jpe?g)$/i) ? "image/jpeg"
      : filePath.match(/\.png$/i) ? "image/png"
      : filePath.match(/\.gif$/i) ? "image/gif"
      : filePath.match(/\.webp$/i) ? "image/webp"
      : "image/jpeg"; // fallback

    const base64 = fileBuffer.toString("base64");
    const fetchFn = opts?.fetchFn ?? globalThis.fetch;

    const description = await describeImage(base64, mimeType, visionConfig, fetchFn);

    return [{ text: description, source: "description" }];
  }
}
