import { readFileSync } from "fs";
import { join } from "path";
import type { SqliteEngine } from "./sqlite-engine.ts";
import type { VisionConfig, FetchFn } from "./vision.ts";
import { describeImage } from "./vision.ts";
import { embed } from "./embedding.ts";
import { isImageMime } from "./files.ts";

export interface ProcessImageResult {
  file_slug: string;
  described: boolean;
  embedded: boolean;
  warning?: string;
}

/**
 * Describe an already-attached image file and write the description + embedding to DB.
 * Shared by: `attach --describe`, `describe` command, importer runner.
 * Does NOT copy the file — caller must have already inserted the file record.
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

  const diskPath = join(filesDir, file.file_path);

  let description: string;
  try {
    const content = readFileSync(diskPath);
    const base64 = content.toString("base64");
    description = await describeImage(base64, file.mime_type, visionCfg, fetchFn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      file_slug: fileSlug,
      described: false,
      embedded: false,
      warning: msg,
    };
  }

  engine.setFileDescription(fileSlug, description);

  let embedded = false;
  try {
    const vec = await embed(description);
    engine.upsertFileChunk(fileSlug, description, vec, embedModel);
    embedded = true;
  } catch (err) {
    // Embedding failure is non-fatal: description is still searchable via FTS
    const msg = err instanceof Error ? err.message : String(err);
    return {
      file_slug: fileSlug,
      described: true,
      embedded: false,
      warning: `Description saved but embedding failed: ${msg}`,
    };
  }

  return { file_slug: fileSlug, described: true, embedded };
}
