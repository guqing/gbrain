import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ContentChunk, ContentExtractor, ExtractOpts } from "./interface.ts";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME = "application/msword";

export class DocumentExtractor implements ContentExtractor {
  supports(mimeType: string): boolean {
    return mimeType === DOCX_MIME || mimeType === DOC_MIME;
  }

  async extract(filePath: string, _opts?: ExtractOpts): Promise<ContentChunk[]> {
    const ext = extname(filePath).toLowerCase();
    if (ext === ".doc") {
      throw new Error(
        `Legacy .doc format is not supported at ${filePath}. ` +
        `Please convert to .docx using LibreOffice or Microsoft Word.`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mammoth: any;
    try {
      mammoth = await import("mammoth");
    } catch {
      throw new Error("mammoth not installed — run: bun add mammoth");
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch (err) {
      throw new Error(`Failed to read DOCX at ${filePath}: ${(err as Error).message}`);
    }

    let rawText: string;
    try {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value ?? "";
    } catch (err) {
      throw new Error(`Failed to parse DOCX at ${filePath}: ${(err as Error).message}`);
    }

    if (!rawText.trim()) {
      return [];
    }

    // Split on blank lines (paragraph boundaries). Non-empty paragraphs become chunks.
    const paragraphs = rawText
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    return paragraphs.map((text, i) => ({
      text,
      source: `para-${i + 1}`,
    }));
  }
}
