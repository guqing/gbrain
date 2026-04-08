import OpenAI from 'openai';
import { loadConfig } from './config.ts';

const MAX_CHARS = 8000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 4000;
const MAX_DELAY_MS = 120000;
const BATCH_SIZE = 100;

function getClient(): OpenAI {
  const cfg = loadConfig();
  const { base_url, api_key, model: _m, dimensions: _d } = cfg.embed;

  // For local providers (Ollama etc.), no real API key is needed
  const isLocal = base_url && (base_url.includes("localhost") || base_url.includes("127.0.0.1"));
  const resolvedKey = api_key ?? (isLocal ? "ollama" : undefined);

  if (!resolvedKey) {
    throw new Error(
      "No embedding API key configured.\n" +
      "  Option 1: gbrain config set embed.api_key <key>\n" +
      "  Option 2: export OPENAI_API_KEY=<key>\n" +
      "  For Vercel AI Gateway: gbrain config set embed.base_url https://ai-gateway.vercel.sh/v1"
    );
  }

  return new OpenAI({
    apiKey: resolvedKey,
    ...(base_url ? { baseURL: base_url } : {}),
  });
}

function getModelConfig(): { model: string; dimensions: number } {
  const cfg = loadConfig();
  return { model: cfg.embed.model, dimensions: cfg.embed.dimensions };
}

export async function embed(text: string): Promise<Float32Array> {
  const truncated = text.slice(0, MAX_CHARS);
  const result = await embedBatch([truncated]);
  return result[0]!;
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const truncated = texts.map(t => t.slice(0, MAX_CHARS));
  const results: Float32Array[] = [];

  for (let i = 0; i < truncated.length; i += BATCH_SIZE) {
    const batch = truncated.slice(i, i + BATCH_SIZE);
    const batchResults = await embedBatchWithRetry(batch);
    results.push(...batchResults);
  }

  return results;
}

async function embedBatchWithRetry(texts: string[]): Promise<Float32Array[]> {
  const { model, dimensions } = getModelConfig();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await getClient().embeddings.create({
        model,
        input: texts,
        dimensions,
      });

      const sorted = response.data.sort((a, b) => a.index - b.index);
      return sorted.map(d => new Float32Array(d.embedding));
    } catch (e: unknown) {
      if (attempt === MAX_RETRIES - 1) throw e;

      let delay = exponentialDelay(attempt);

      if (e instanceof OpenAI.APIError && e.status === 429) {
        const retryAfter = (e.headers as Record<string, string>)?.['retry-after'];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) delay = parsed * 1000;
        }
      }

      await sleep(delay);
    }
  }

  throw new Error('Embedding failed after all retries');
}

function exponentialDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Dynamic exports — read from config at call time
export function EMBEDDING_MODEL(): string { return loadConfig().embed.model; }
export function EMBEDDING_DIMENSIONS(): number { return loadConfig().embed.dimensions; }

// ── Compatibility aliases ─────────────────────────────────────────────────────

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  return embedBatch(texts);
}

export function embeddingToBlob(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

export function blobToEmbedding(blob: Buffer): number[] {
  const floats = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  return Array.from(floats);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
