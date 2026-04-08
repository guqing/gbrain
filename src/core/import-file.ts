import { readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import type { BrainEngine } from './engine.ts';
import { parsePage } from './markdown.ts';
import { chunkText } from './chunkers/recursive.ts';
import { embedBatch } from './embedding.ts';
import type { ChunkInput } from '../types.ts';

export interface ImportFileResult {
  slug: string;
  status: 'imported' | 'skipped' | 'error';
  chunks: number;
  error?: string;
}

const MAX_FILE_SIZE = 1_000_000;

export async function importFile(
  engine: BrainEngine,
  filePath: string,
  relativePath: string,
  opts: { noEmbed: boolean },
): Promise<ImportFileResult> {
  let stat;
  try { stat = statSync(filePath); } catch (e) {
    return { slug: relativePath, status: 'error', chunks: 0, error: String(e) };
  }
  if (stat.size > MAX_FILE_SIZE) {
    return { slug: relativePath, status: 'skipped', chunks: 0, error: `File too large (${stat.size} bytes)` };
  }

  const content = readFileSync(filePath, 'utf-8');
  const parsed = parsePage(content, relativePath.replace(/\.md$/, ''));
  const slug = parsed.slug;

  const hash = createHash('sha256')
    .update(parsed.compiled_truth + '\n---\n' + (parsed.timeline ?? ''))
    .digest('hex');

  const existing = engine.getPage(slug);
  if (existing?.content_hash === hash) {
    return { slug, status: 'skipped', chunks: 0 };
  }

  engine.putPage(slug, {
    type: parsed.type,
    title: parsed.title,
    compiled_truth: parsed.compiled_truth,
    timeline: parsed.timeline ?? '',
    frontmatter: { ...parsed.frontmatter, content_hash: hash } as Record<string, unknown>,
  });

  const existingTags = engine.getTags(slug);
  const newTags = new Set(parsed.frontmatter.tags ?? []);
  for (const oldTag of existingTags) {
    if (!newTags.has(oldTag)) engine.removeTag(slug, oldTag);
  }
  for (const tag of parsed.frontmatter.tags ?? []) {
    engine.addTag(slug, tag as string);
  }

  const chunks: ChunkInput[] = [];
  if (parsed.compiled_truth.trim()) {
    const ctChunks = chunkText(parsed.compiled_truth);
    for (const c of ctChunks) {
      chunks.push({ chunk_index: chunks.length, chunk_text: c.text, chunk_source: 'compiled_truth' });
    }
  }
  if (parsed.timeline && parsed.timeline.trim()) {
    const tlChunks = chunkText(parsed.timeline);
    for (const c of tlChunks) {
      chunks.push({ chunk_index: chunks.length, chunk_text: c.text, chunk_source: 'timeline' });
    }
  }

  if (!opts.noEmbed && chunks.length > 0) {
    try {
      const embeddings = await embedBatch(chunks.map(c => c.chunk_text));
      for (let j = 0; j < chunks.length; j++) {
        chunks[j]!.embedding = embeddings[j];
        chunks[j]!.token_count = Math.ceil(chunks[j]!.chunk_text.length / 4);
      }
    } catch {
      // non-fatal
    }
  }

  if (chunks.length > 0) {
    engine.upsertChunks(slug, chunks);
  }

  return { slug, status: 'imported', chunks: chunks.length };
}
