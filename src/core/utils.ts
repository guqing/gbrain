import { createHash } from "crypto";

/**
 * Convert a string to a URL-safe kebab-case slug.
 */
export function slugify(text: string, maxLen = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, maxLen)
    .replace(/-+$/, "");
}

/**
 * Generate a unique inbox slug: inbox/{ISO8601compact}-{hash4}
 * Hash is first 4 chars of SHA256(content) to prevent exact duplicates on batch capture.
 */
export function generateInboxSlug(content: string): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const hash4 = createHash("sha256").update(content).digest("hex").slice(0, 4);
  return `inbox/${ts}-${hash4}`;
}

/**
 * Resolve slug conflicts: if slug exists, append -2, -3, etc.
 */
export function deconflictSlug(
  slug: string,
  exists: (s: string) => boolean,
): string {
  if (!exists(slug)) return slug;
  let n = 2;
  while (exists(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}
