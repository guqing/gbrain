import type { BrainEngine } from '../engine.ts';
import type { SearchResult, SearchOpts } from '../../types.ts';

export function keywordSearch(engine: BrainEngine, query: string, opts?: SearchOpts): SearchResult[] {
  return engine.searchKeyword(query, opts);
}
