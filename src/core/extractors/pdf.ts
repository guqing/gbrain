import { readFile } from "node:fs/promises";
import type { ContentChunk, ContentExtractor, ExtractOpts } from "./interface.ts";

const PDF_MIMES = new Set(["application/pdf"]);

export class PdfExtractor implements ContentExtractor {
  supports(mimeType: string): boolean {
    return PDF_MIMES.has(mimeType);
  }

  async extract(filePath: string, _opts?: ExtractOpts): Promise<ContentChunk[]> {
    let getDocumentProxy: typeof import("unpdf").getDocumentProxy;
    let extractText: typeof import("unpdf").extractText;
    try {
      const mod = await import("unpdf");
      getDocumentProxy = mod.getDocumentProxy;
      extractText = mod.extractText;
    } catch {
      throw new Error("unpdf not installed — run: bun add unpdf");
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch (err) {
      throw new Error(`Failed to read PDF at ${filePath}: ${(err as Error).message}`);
    }

    let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      doc = await getDocumentProxy(new Uint8Array(buffer));
    } catch (err) {
      throw new Error(`Failed to parse PDF at ${filePath}: ${(err as Error).message}`);
    }

    let pageTexts: string[];
    try {
      const result = await extractText(doc);
      pageTexts = result.text;
    } catch (err) {
      throw new Error(`Failed to extract text from PDF at ${filePath}: ${(err as Error).message}`);
    }

    const chunks: ContentChunk[] = [];
    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = pageTexts[i]?.trim() ?? "";
      if (!pageText) {
        console.warn(`[pdf] page ${i + 1} of ${filePath} has no extractable text (image-only?)`);
        continue;
      }
      chunks.push({ text: pageText, source: `page-${i + 1}` });
    }

    return chunks;
  }
}
