import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { embed } from "../core/embedding.ts";
import { loadConfig } from "../core/config.ts";

/**
 * Expand a search query using the compile LLM to surface synonyms and related terms.
 * Returns the expanded query string, or the original if expansion fails/unavailable.
 */
async function expandQuery(
  query: string,
  cfg: { base_url?: string; api_key?: string; model?: string },
): Promise<string> {
  if (!cfg.api_key) return query;

  const baseUrl = cfg.base_url ?? "https://api.openai.com/v1";
  const model = cfg.model ?? "gpt-4.1-mini";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.api_key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content:
              "Expand the user's search query with synonyms and related technical terms to improve retrieval. " +
              "Return only the expanded query as plain text — no explanation, no bullet points, no JSON. " +
              "Keep it under 80 words. Preserve the original language of the query.",
          },
          { role: "user", content: query },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) return query;

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const expanded = data.choices?.[0]?.message?.content?.trim();
    return expanded && expanded.length > 0 ? expanded : query;
  } catch {
    return query;
  }
}

export default defineCommand({
  meta: { name: "query", description: "Hybrid search (FTS5 + vector RRF + query expansion)" },
  args: {
    query: { type: "positional", description: "Search query", required: true },
    db: { type: "string", description: "Path to brain.db" },
    limit: { type: "string", description: "Max results (default 10)" },
    type: { type: "string", description: "Filter by page type" },
    "no-expand": {
      type: "boolean",
      description: "Disable LLM query expansion (faster, exact terms only)",
      default: false,
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const cfg = loadConfig(args.db ? { db: args.db } : undefined);
    const isLocal =
      cfg.embed.base_url &&
      (cfg.embed.base_url.includes("localhost") || cfg.embed.base_url.includes("127.0.0.1"));
    const hasEmbedKey = !!cfg.embed.api_key || isLocal;

    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);
    const limit = args.limit ? parseInt(args.limit, 10) : 10;
    const originalQuery = args.query as string;

    // Query expansion: only when compile.api_key is available and --no-expand not set
    const noExpand = args["no-expand"] as boolean;
    let searchQuery = originalQuery;
    if (!noExpand && cfg.compile?.api_key) {
      searchQuery = await expandQuery(originalQuery, cfg.compile);
    }

    // Embed for vector component (optional — falls back to FTS5-only hybrid)
    let embedding: Float32Array | null = null;
    if (hasEmbedKey) {
      try {
        embedding = await embed(searchQuery);
      } catch {
        if (!args.json) console.error("⚠ Embedding failed — falling back to keyword search.");
      }
    }

    const results = engine.hybridSearch(searchQuery, embedding, { limit, type: args.type });

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log("No results.");
      return;
    }

    if (!noExpand && searchQuery !== originalQuery && !args.json) {
      console.log(`  (expanded: ${searchQuery.slice(0, 80)}${searchQuery.length > 80 ? "…" : ""})\n`);
    }

    for (const r of results) {
      console.log(`[${r.score.toFixed(3)}] ${r.slug}  (${r.type})`);
      console.log(`  ${r.chunk_text.slice(0, 120).replace(/\n/g, " ")}…`);
    }
  },
});
