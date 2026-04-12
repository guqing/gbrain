import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { embed } from "../core/embedding.ts";
import { loadConfig } from "../core/config.ts";
import { getCachedQuery, setCachedQuery, ensureQueryCacheTable } from "../core/search/cache.ts";

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
    const timer = setTimeout(() => controller.abort(), 3_000);

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

/**
 * Extract a keyword-anchored snippet from text.
 * Finds the first occurrence of any query term and returns context around it.
 * Falls back to the beginning of the text if no terms are found.
 */
function extractSnippet(text: string, query: string, maxLen = 200): string {
  // Strip YAML frontmatter (--- ... ---) that leaks into snippets for Copilot session pages
  let stripped = text;
  if (stripped.trimStart().startsWith('---')) {
    const end = stripped.indexOf('\n---', 3);
    if (end !== -1) stripped = stripped.slice(end + 4);
  }
  // Strip markdown HR separators that bleed into snippets
  const clean = stripped.replace(/\n?-{3,}\n?/g, ' ').replace(/\s+/g, ' ').trim();

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2)
    .slice(0, 8);

  let best = -1;
  for (const term of terms) {
    const idx = clean.toLowerCase().indexOf(term);
    if (idx !== -1 && (best === -1 || idx < best)) {
      best = idx;
    }
  }

  if (best === -1) {
    // No term found: take start of text
    return clean.length > maxLen
      ? clean.slice(0, clean.lastIndexOf(' ', maxLen) || maxLen) + '…'
      : clean;
  }

  const contextBefore = Math.floor(maxLen * 0.25);
  const start = Math.max(0, best - contextBefore);
  const end = start + maxLen;

  let snip = clean.slice(start, end);
  // Trim to word boundaries
  if (start > 0) {
    const ws = snip.indexOf(' ');
    if (ws > 0 && ws < 20) snip = snip.slice(ws + 1);
  }
  if (end < clean.length) {
    const ls = snip.lastIndexOf(' ');
    if (ls > snip.length - 20) snip = snip.slice(0, ls);
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  return prefix + snip + suffix;
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

    if (!hasEmbedKey && !args.json) {
      console.error("⚠  向量搜索不可用（未配置 embed API key）— 已降级为纯关键词搜索，结果质量会下降。\n");
    }

    const db = openDb(resolveDbPath(args.db));
    ensureQueryCacheTable(db);
    const engine = new SqliteEngine(db);
    const limit = args.limit ? parseInt(args.limit, 10) : 10;
    const originalQuery = args.query as string;

    const noExpand = args["no-expand"] as boolean;
    let searchQuery = originalQuery;
    let embedding: Float32Array | null = null;

    // Check cache first — avoids LLM + embed API calls on repeated queries (~10ms)
    const cached = getCachedQuery(db, originalQuery);
    if (cached) {
      searchQuery = cached.expanded;
      embedding = cached.embedding;
    } else if (hasEmbedKey || (!noExpand && cfg.compile?.api_key)) {
      // Parallel: expand query + embed original query simultaneously
      const [expandedQuery, originalEmbedding] = await Promise.all([
        (!noExpand && cfg.compile?.api_key)
          ? expandQuery(originalQuery, cfg.compile).catch(() => originalQuery)
          : Promise.resolve(originalQuery),
        hasEmbedKey
          ? embed(originalQuery).catch(() => null)
          : Promise.resolve(null),
      ]);

      searchQuery = expandedQuery;
      embedding = originalEmbedding;

      // If query was expanded, re-embed the expanded version for better vector match
      if (hasEmbedKey && searchQuery !== originalQuery) {
        embedding = await embed(searchQuery).catch(() => originalEmbedding);
      }

      // Cache for next time (fire and forget — don't delay results)
      try { setCachedQuery(db, originalQuery, searchQuery, embedding); } catch { /* ignore */ }
    } else if (hasEmbedKey) {
      embedding = await embed(originalQuery).catch(() => null);
    }

    const results = engine.hybridSearch(searchQuery, embedding, {
      limit,
      type: args.type,
      // Always use the original query for FTS — expanded queries may contain '…'
      // or other characters that cause FTS5 to silently return 0 results.
      keywordQuery: originalQuery,
    });

    if (args.json) {
      // Ensure all results have a snippet populated (file results from vector search
      // have chunk_text but snippet=null — JSON consumers need a non-null snippet).
      const withSnippets = results.map(r => ({
        ...r,
        snippet: r.snippet ?? (r.chunk_text ? extractSnippet(r.chunk_text, originalQuery, 200) : ''),
      }));
      console.log(JSON.stringify(withSnippets, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log("No results.");
      return;
    }

    if (!noExpand && searchQuery !== originalQuery && !args.json) {
      // Show first ~60 chars of expansion then truncate at a word boundary
      const exp = searchQuery.replace(/\n/g, " ");
      const short = exp.length > 60 ? exp.slice(0, exp.lastIndexOf(" ", 60) || 60) + " …" : exp;
      console.log(`  expanded: ${originalQuery} → ${short}\n`);
    }

    const numWidth = String(results.length).length;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const label = String(i + 1).padStart(numWidth);

      // Build a human-readable display name.
      // For file results, strip the ChatGPT export prefix (file-{id}-{name}.ext → {name}.ext).
      let display: string;
      if (r.result_kind === "file" && r.title) {
        // ChatGPT export filenames look like: file-{id}-{actual-name}.ext
        // Strip the leading "file-{id}-" prefix to expose the meaningful part.
        const stripped = r.title.replace(/^file-[A-Za-z0-9]+-/, "");
        display = stripped || r.title;
      } else {
        display = r.title && r.title !== r.slug ? r.title : r.slug;
      }

      // Truncate to 46 chars for column alignment
      const name = display.length > 46 ? display.slice(0, 45) + "…" : display;
      const typeStr = r.type === "page" ? "page" : r.type;

      // Show chunk source for non-image file results (PDF page, DOCX para, transcript)
      const chunkSrc = r.result_kind === "file" && r.chunk_source && r.chunk_source !== "description" && r.chunk_source !== "file_description"
        ? `  [${r.chunk_source}]`
        : "";

      const meta = `${typeStr}  ${r.score.toFixed(3)}`;
      console.log(` ${label}  ${name.padEnd(48)} ${meta}${chunkSrc}`);

      // Keyword-anchored snippet: find where the query terms appear in the text
      // so the user sees relevant context rather than the start of the chunk.
      const raw = (r.snippet ?? r.chunk_text);
      const snip = extractSnippet(raw, originalQuery, 200);
      console.log(`    ${snip}\n`);
    }
  },
});
