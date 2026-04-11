import { readFileSync } from "fs";
import { join } from "path";
import type { SqliteEngine } from "./sqlite-engine.ts";
import type { VisionConfig, FetchFn } from "./vision.ts";
import { describeImage } from "./vision.ts";
import { embed, embedTexts, EMBEDDING_MODEL } from "./embedding.ts";
import { isImageMime } from "./files.ts";
import { registry } from "./extractors/index.ts";
import type { ExtractOpts } from "./extractors/interface.ts";

export interface ProcessImageResult {
  file_slug: string;
  described: boolean;
  embedded: boolean;
  warning?: string;
}

export interface ProcessFileOpts {
  visionCfg?: VisionConfig;
  fetchFn?: FetchFn;
  transcriptionBaseUrl?: string;
  transcriptionApiKey?: string;
}

export interface ProcessFileResult {
  file_slug: string;
  chunks_stored: number;
  embedded: boolean;
  warning?: string;
}

/**
 * Process any file type — dispatch via ExtractorRegistry.
 *
 * Data flow:
 *   file on disk
 *     → ExtractorRegistry.get(mimeType)
 *     → ContentExtractor.extract()
 *     → embedTexts(all chunks)   [one batch API call]
 *     → upsertFileChunks()       [delete-then-insert transaction]
 *     → setProcessedAt()
 *
 * For images, also writes files.description for backward-compat FTS.
 */
export async function processFileContent(
  engine: SqliteEngine,
  fileSlug: string,
  filesDir: string,
  opts: ProcessFileOpts = {},
): Promise<ProcessFileResult> {
  const file = engine.getFile(fileSlug);
  if (!file) throw new Error(`File not found: ${fileSlug}`);

  const extractor = registry.get(file.mime_type);
  if (!extractor) {
    return {
      file_slug: fileSlug,
      chunks_stored: 0,
      embedded: false,
      warning: `No extractor for MIME type ${file.mime_type}`,
    };
  }

  const diskPath = join(filesDir, file.file_path);
  const extractOpts: ExtractOpts & { visionConfig?: VisionConfig } = {
    fetchFn: opts.fetchFn,
    transcriptionBaseUrl: opts.transcriptionBaseUrl,
    transcriptionApiKey: opts.transcriptionApiKey,
  };
  if (opts.visionCfg) {
    (extractOpts as { visionConfig?: VisionConfig }).visionConfig = opts.visionCfg;
  }

  let chunks: Awaited<ReturnType<typeof extractor.extract>>;
  try {
    chunks = await extractor.extract(diskPath, extractOpts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { file_slug: fileSlug, chunks_stored: 0, embedded: false, warning: msg };
  }

  if (chunks.length === 0) {
    engine.setProcessedAt(fileSlug);
    return { file_slug: fileSlug, chunks_stored: 0, embedded: false, warning: "Extractor returned no text" };
  }

  // For images, also persist description to files.description for FTS + display compat.
  if (isImageMime(file.mime_type) && chunks[0]) {
    engine.setFileDescription(fileSlug, chunks[0].text);
  }

  const embedModel = EMBEDDING_MODEL();
  let embeddings: Float32Array[];
  try {
    embeddings = await embedTexts(chunks.map(c => c.text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      file_slug: fileSlug,
      chunks_stored: 0,
      embedded: false,
      warning: `Embedding failed: ${msg}`,
    };
  }

  engine.upsertFileChunks(fileSlug, chunks, embeddings, embedModel);
  engine.setProcessedAt(fileSlug);

  return { file_slug: fileSlug, chunks_stored: chunks.length, embedded: true };
}

/**
 * Describe an already-attached image file and write the description + embedding to DB.
 * Shared by: `attach --describe`, `describe` command, importer runner.
 * Does NOT copy the file — caller must have already inserted the file record.
 *
 * @deprecated Use processFileContent() for new callers. This is a thin adapter for
 *             backward compatibility.
 */
export async function describeAndEmbedFile(
  engine: SqliteEngine,
  fileSlug: string,
  filesDir: string,
  visionCfg: VisionConfig,
  embedModel: string,
  fetchFn: FetchFn = fetch,
): Promise<ProcessImageResult> {
  const file = engine.getFile(fileSlug);
  if (!file) throw new Error(`File not found: ${fileSlug}`);

  if (!isImageMime(file.mime_type)) {
    return {
      file_slug: fileSlug,
      described: false,
      embedded: false,
      warning: `Not an image file (${file.mime_type}). Skipped.`,
    };
  }

  const result = await processFileContent(engine, fileSlug, filesDir, { visionCfg, fetchFn });
  return {
    file_slug: fileSlug,
    described: result.chunks_stored > 0,
    embedded: result.embedded,
    warning: result.warning,
  };
}

