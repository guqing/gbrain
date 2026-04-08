/**
 * Multi-Query Expansion via Claude Haiku
 */

import Anthropic from '@anthropic-ai/sdk';

const MAX_QUERIES = 3;
const MIN_WORDS = 3;

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

export async function expandQuery(query: string): Promise<string[]> {
  const wordCount = (query.match(/\S+/g) || []).length;
  if (wordCount < MIN_WORDS) return [query];

  try {
    const alternatives = await callHaikuForExpansion(query);
    const all = [query, ...alternatives];
    const unique = [...new Set(all.map(q => q.toLowerCase().trim()))];
    return unique.slice(0, MAX_QUERIES).map(q =>
      all.find(orig => orig.toLowerCase().trim() === q) || q,
    );
  } catch {
    return [query];
  }
}

async function callHaikuForExpansion(query: string): Promise<string[]> {
  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    tools: [
      {
        name: 'expand_query',
        description: 'Generate alternative phrasings of a search query to improve recall',
        input_schema: {
          type: 'object' as const,
          properties: {
            alternative_queries: {
              type: 'array',
              items: { type: 'string' },
              description: '2 alternative phrasings of the original query',
            },
          },
          required: ['alternative_queries'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'expand_query' },
    messages: [
      {
        role: 'user',
        content: `Generate 2 alternative search queries that would find relevant results for this question.\n\nOriginal query: "${query}"`,
      },
    ],
  });

  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'expand_query') {
      const input = block.input as { alternative_queries?: unknown };
      const alts = input.alternative_queries;
      if (Array.isArray(alts)) {
        return alts.map(String).slice(0, 2);
      }
    }
  }

  return [];
}
