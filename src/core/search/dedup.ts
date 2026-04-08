/**
 * 4-Layer Dedup Pipeline
 */

import type { SearchResult } from '../../types.ts';

const COSINE_DEDUP_THRESHOLD = 0.85;
const MAX_TYPE_RATIO = 0.6;
const MAX_PER_PAGE = 2;

export function dedupResults(
  results: SearchResult[],
  opts?: {
    cosineThreshold?: number;
    maxTypeRatio?: number;
    maxPerPage?: number;
  },
): SearchResult[] {
  const threshold = opts?.cosineThreshold ?? COSINE_DEDUP_THRESHOLD;
  const maxRatio = opts?.maxTypeRatio ?? MAX_TYPE_RATIO;
  const maxPerPage = opts?.maxPerPage ?? MAX_PER_PAGE;

  let deduped = results;
  deduped = dedupBySource(deduped);
  deduped = dedupByTextSimilarity(deduped, threshold);
  deduped = enforceTypeDiversity(deduped, maxRatio);
  deduped = capPerPage(deduped, maxPerPage);

  return deduped;
}

function dedupBySource(results: SearchResult[]): SearchResult[] {
  const byPage = new Map<string, SearchResult>();

  for (const r of results) {
    const existing = byPage.get(r.slug);
    if (!existing || r.score > existing.score) {
      byPage.set(r.slug, r);
    }
  }

  return Array.from(byPage.values()).sort((a, b) => b.score - a.score);
}

function dedupByTextSimilarity(results: SearchResult[], threshold: number): SearchResult[] {
  const kept: SearchResult[] = [];

  for (const r of results) {
    const rWords = new Set(r.chunk_text.toLowerCase().split(/\s+/));
    let tooSimilar = false;

    for (const k of kept) {
      const kWords = new Set(k.chunk_text.toLowerCase().split(/\s+/));
      const intersection = new Set([...rWords].filter(w => kWords.has(w)));
      const union = new Set([...rWords, ...kWords]);
      const jaccard = intersection.size / union.size;

      if (jaccard > threshold) {
        tooSimilar = true;
        break;
      }
    }

    if (!tooSimilar) {
      kept.push(r);
    }
  }

  return kept;
}

function enforceTypeDiversity(results: SearchResult[], maxRatio: number): SearchResult[] {
  const maxPerType = Math.max(1, Math.ceil(results.length * maxRatio));
  const typeCounts = new Map<string, number>();
  const kept: SearchResult[] = [];

  for (const r of results) {
    const count = typeCounts.get(r.type) || 0;
    if (count < maxPerType) {
      kept.push(r);
      typeCounts.set(r.type, count + 1);
    }
  }

  return kept;
}

function capPerPage(results: SearchResult[], maxPerPage: number): SearchResult[] {
  const pageCounts = new Map<string, number>();
  const kept: SearchResult[] = [];

  for (const r of results) {
    const count = pageCounts.get(r.slug) || 0;
    if (count < maxPerPage) {
      kept.push(r);
      pageCounts.set(r.slug, count + 1);
    }
  }

  return kept;
}
