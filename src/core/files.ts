import { createHash } from "crypto";
import { extname, basename } from "path";
import { existsSync } from "fs";
import { join } from "path";

export const MIME_TYPES: Record<string, string> = {
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".heic": "image/heic",
  ".tiff": "image/tiff",
  ".tif":  "image/tiff",
  ".pdf":  "application/pdf",
  ".mp4":  "video/mp4",
  ".m4a":  "audio/mp4",
  ".mp3":  "audio/mpeg",
  ".wav":  "audio/wav",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function getMimeType(filePath: string): string | null {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? null;
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function fileHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Convert a filename or description to a kebab slug, max 80 chars. */
export function toFileSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Find a non-colliding filename on disk.
 * react-diagram → react-diagram-2 → react-diagram-3 ...
 * Checks filesystem only (DB uniqueness enforced separately via UNIQUE constraint).
 */
export function resolveFileSlug(
  desiredSlug: string,
  ext: string,
  filesDir: string,
): string {
  let candidate = desiredSlug;
  let attempt = 1;
  while (existsSync(join(filesDir, `${candidate}${ext}`))) {
    attempt++;
    candidate = `${desiredSlug}-${attempt}`;
    if (attempt > 999) {
      throw new Error(`Too many slug collisions for: ${desiredSlug}`);
    }
  }
  return candidate;
}

export function getFilesDir(): string {
  return join(
    process.env["HOME"] ?? (process.platform === "win32" ? process.env["USERPROFILE"] ?? "" : "/"),
    ".exo",
    "files",
  );
}

/** basename without extension, used as the initial slug candidate. */
export function baseSlug(filePath: string): string {
  const name = basename(filePath, extname(filePath));
  return toFileSlug(name) || "file";
}
