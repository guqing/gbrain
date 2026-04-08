import type { BrainEngine } from '../engine.ts';
import type { SearchResult, SearchOpts } from '../../types.ts';
import { embed } from '../embedding.ts';
import { dedupResults } from './dedup.ts';

const RRF_K = 60;

export interface HybridSearchOpts extends SearchOpts {
  expansion?: boolean;
  expandFn?: (query: string) => Promise<string[]>;
}

export async function hybridSearch(
  engine: BrainEngine,
  query: string,
  opts?: HybridSearchOpts,
): Promise<SearchResult[]> {
  const limit = opts?.limit || 20;

  let queries = [query];
  if (opts?.expansion && opts?.expandFn) {
    try {
      const expanded = await opts.expandFn(query);
      queries = [query, ...expanded].slice(0, 3);
    } catch {
      // non-fatal
    }
  }

  const embeddings = await Promise.all(queries.map(q => embed(q)));
  const vectorLists = embeddings.map(emb => engine.searchVector(emb, { limit: limit * 2 }));
  const keywordResults = engine.searchKeyword(query, { limit: limit * 2 });

  const allLists = [...vectorLists, keywordResults];
  const fused = rrfFusion(allLists);
  const deduped = dedupResults(fused);

  return deduped.slice(0, limit);
}

function rrfFusion(lists: SearchResult[][]): SearchResult[] {
  const scores = new Map<string, { result: SearchResult; score: number }>();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const r = list[rank]!;
      const key = `${r.slug}:${r.chunk_text.slice(0, 50)}`;
      const existing = scores.get(key);
      const rrfScore = 1 / (RRF_K + rank);

      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(key, { result: r, score: rrfScore });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
}
