import type { BrainEngine } from '../engine.ts';
import type { SearchResult, SearchOpts } from '../../types.ts';

export function vectorSearch(engine: BrainEngine, embedding: Float32Array, opts?: SearchOpts): SearchResult[] {
  return engine.searchVector(embedding, opts);
}
