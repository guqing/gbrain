/**
 * Unified content extraction interface for v0.6.
 *
 * Every file type (PDF, DOCX, audio, video, image) implements ContentExtractor.
 * The ExtractorRegistry dispatches to the right adapter based on MIME type.
 *
 * Data flow:
 *
 *   file on disk
 *       │
 *       ▼
 *   ExtractorRegistry.get(mimeType)
 *       │
 *       ▼
 *   ContentExtractor.extract(filePath, opts)
 *       │
 *       ▼
 *   ContentChunk[]  (text + chunk_source label)
 *       │
 *       ▼
 *   embedTexts(chunks)  [batch — one API call]
 *       │
 *       ▼
 *   upsertFileChunks(fileSlug, chunks, embeddings)
 *       │
 *       ▼
 *   setProcessedAt(fileSlug)
 */

export interface ContentChunk {
  /** The text to embed and store. */
  text: string;
  /**
   * Source label stored in file_chunks.chunk_source.
   * - Images: "description"
   * - PDF pages: "page-1", "page-2", ...
   * - DOCX paragraphs: "para-1", "para-2", ...
   * - Audio segments: "t:00:00-00:30"
   * - Full transcript: "transcript"
   */
  source: string;
}

export interface ExtractOpts {
  /**
   * Injected fetch — used in tests to mock Whisper API calls.
   * Defaults to globalThis.fetch if omitted.
   */
  fetchFn?: typeof fetch;

  /**
   * OpenAI-compatible base URL for Whisper transcription.
   * Defaults to config value if omitted.
   */
  transcriptionBaseUrl?: string;

  /**
   * API key for Whisper transcription.
   */
  transcriptionApiKey?: string;
}

export interface ContentExtractor {
  /** Returns true if this extractor handles the given MIME type. */
  supports(mimeType: string): boolean;

  /**
   * Extract text content from the file at filePath.
   * @throws with a descriptive message on parse failure, missing tool (ffmpeg), etc.
   */
  extract(filePath: string, opts?: ExtractOpts): Promise<ContentChunk[]>;
}
