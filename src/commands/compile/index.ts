import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../../core/db.ts";
import { SqliteEngine } from "../../core/sqlite-engine.ts";
import { loadConfig, type GbrainConfig } from "../../core/config.ts";
import { slugify, deconflictSlug } from "../../core/utils.ts";
import { callLlm, type FetchFn } from "./llm.ts";
import type { Page } from "../../types.ts";

// ── Noise log helpers ──────────────────────────────────────────────────────

interface NoiseEntry {
  slug: string;
  reason: string;
  timestamp: string;
}

const NOISE_LOG_KEY = "compile.noise_log";
const NOISE_LOG_CAP = 100;

function appendNoiseLog(engine: SqliteEngine, slug: string, reason: string): void {
  const raw = engine.getMeta(NOISE_LOG_KEY);
  let entries: NoiseEntry[] = [];
  if (raw) {
    try { entries = JSON.parse(raw); } catch { /* reset */ }
  }
  entries.push({ slug, reason, timestamp: new Date().toISOString() });
  if (entries.length > NOISE_LOG_CAP) entries = entries.slice(-NOISE_LOG_CAP);
  engine.setMeta(NOISE_LOG_KEY, JSON.stringify(entries));
}

// ── Embedding helpers ──────────────────────────────────────────────────────

async function embedText(text: string, config: ReturnType<typeof loadConfig>): Promise<Float32Array | null> {
  const apiKey = config.embed.api_key;
  const baseUrl = config.embed.base_url ?? "https://api.openai.com/v1";
  const model = config.embed.model ?? "text-embedding-3-small";
  if (!apiKey) return null;

  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: text.slice(0, 8000) }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ embedding: number[] }> };
    const vec = data.data?.[0]?.embedding;
    if (!vec) return null;
    return new Float32Array(vec);
  } catch {
    return null;
  }
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── Interactive TTY prompt ─────────────────────────────────────────────────

async function confirmItem(
  n: number,
  total: number,
  action: string,
  slug: string,
  title: string,
): Promise<"y" | "n" | "q"> {
  process.stdout.write(
    `[${n}/${total}] ${title}\n  Action: ${action} → ${slug}\n  [y]es / [n]o / [q]uit: `,
  );
  // Read a single char from stdin
  return new Promise((resolve) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (key: string) => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      const k = key.toLowerCase().trim();
      process.stdout.write("\n");
      if (k === "q") resolve("q");
      else if (k === "n") resolve("n");
      else resolve("y");
    });
  });
}

// ── Core pipeline ──────────────────────────────────────────────────────────

export interface RunCompileOpts {
  dbPath?: string;
  limit: number;
  yes: boolean;
  interactive: boolean;
  fetchFn?: FetchFn;
  /** Override compile config (useful in tests to inject api_key without a real config file) */
  compileConfig?: GbrainConfig["compile"];
}

export interface RunCompileResult {
  processed: number;
  created: number;
  updated: number;
  noise: number;
  errors: string[];
}

export async function runCompile(opts: RunCompileOpts): Promise<RunCompileResult> {
  const config = loadConfig({ db: opts.dbPath });
  const db = openDb(config.db.path!);
  const engine = new SqliteEngine(db);

  const compileConfig = opts.compileConfig ?? config.compile;

  const items = engine.listPages({ type: "inbox", limit: opts.limit });
  if (items.length === 0) {
    return { processed: 0, created: 0, updated: 0, noise: 0, errors: [] };
  }

  const total = items.length;
  let created = 0, updated = 0, noise = 0;
  const errors: string[] = [];
  let aborted = false;
  let processedCount = 0;

  // SIGINT handler — already-committed items stay, rest preserved in inbox
  // Write-last pattern: DB writes happen only after LLM validates
  const sigintHandler = () => { aborted = true; };
  process.once("SIGINT", sigintHandler);

  for (let i = 0; i < items.length; i++) {
    if (aborted) break;

    const item = items[i]!;
    const n = i + 1;

    process.stderr.write(`[${n}/${total}] Processing: ${item.title.slice(0, 60)}\n`);

    // Step 1: embed inbox item (on-the-fly, uses embed config)
    const embedding = await embedText(item.compiled_truth, config);

    // Step 2: find most similar existing knowledge pages
    let topPages: Array<{ slug: string; title: string; score: number }> = [];
    if (embedding) {
      const results = engine.searchVector(embedding, { limit: 10, exclude_slugs: [] });
      topPages = results
        .filter(r => r.type === "concept")
        .slice(0, 3)
        .map(r => ({ slug: r.slug, title: r.title, score: r.score }));
    } else {
      // Fallback: FTS search
      const kws = item.compiled_truth.slice(0, 100);
      const results = engine.searchKeyword(kws, { limit: 10 });
      topPages = results
        .filter(r => r.type === "concept")
        .slice(0, 3)
        .map(r => ({ slug: r.slug, title: r.title, score: r.score }));
    }

    // Step 3: call LLM
    let compileItem;
    try {
      compileItem = await callLlm(
        item.compiled_truth,
        topPages.map(p => ({ slug: p.slug, title: p.title })),
        compileConfig,
        opts.fetchFn,
      );
    } catch (err) {
      // ADR-2: skip + log + continue — inbox item preserved
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${item.slug}] ${msg}`);
      process.stderr.write(`  ✗ LLM error: ${msg}\n`);
      continue;
    }

    // Step 4: graph-aware downgrade (score > 0.9 → force update)
    if (compileItem.action === "create" && embedding && topPages.length > 0) {
      const topScore = topPages[0]!.score;
      if (topScore > 0.9 && topPages[0]!.slug) {
        compileItem = { ...compileItem, action: "update" as const, slug: topPages[0]!.slug };
      }
    }

    // Step 5: interactive confirmation
    if (opts.interactive && !opts.yes) {
      const targetSlug = compileItem.slug ?? "(new)";
      const ans = await confirmItem(n, total, compileItem.action, targetSlug, compileItem.title ?? item.title);
      if (ans === "q") { aborted = true; break; }
      if (ans === "n") continue;
    } else if (!opts.yes && !process.stdout.isTTY) {
      console.error("✗ Non-interactive mode: use --yes to skip confirmation.");
      process.exit(1);
    }

    // Step 6: write to DB (write-last — safe vs SIGINT)
    try {
      if (compileItem.action === "noise") {
        appendNoiseLog(engine, item.slug, compileItem.reasoning ?? compileItem.compiled_truth.slice(0, 200));
        engine.deletePage(item.slug);
        noise++;
      } else if (compileItem.action === "update" && compileItem.slug) {
        const existing = engine.getPage(compileItem.slug);
        if (existing) {
          engine.putPage(compileItem.slug, {
            type: existing.type,
            title: compileItem.title ?? existing.title,
            compiled_truth: compileItem.compiled_truth,
            timeline: existing.timeline,
            frontmatter: existing.frontmatter,
          });
          if (compileItem.timeline_entry) {
            engine.addTimelineEntry(compileItem.slug, {
              date: new Date().toISOString().slice(0, 10),
              source: "compile",
              summary: compileItem.timeline_entry,
            });
          }
          // Embed the updated page
          if (embedding) {
            engine.upsertChunks(compileItem.slug, [{
              chunk_index: 0,
              chunk_text: compileItem.compiled_truth.slice(0, 8000),
              chunk_source: "compiled_truth",
              embedding,
            }]);
          }
          engine.deletePage(item.slug);
          updated++;
        } else {
          // Slug not found — treat as create
          compileItem = { ...compileItem, action: "create" as const };
        }
      }

      if (compileItem.action === "create") {
        const rawSlug = compileItem.slug
          ? slugify(compileItem.slug)
          : slugify(compileItem.title ?? item.title);
        const finalSlug = deconflictSlug(rawSlug, (s) => engine.getPage(s) !== null);
        const title = compileItem.title ?? item.title;
        engine.putPage(finalSlug, {
          type: "concept",
          title,
          compiled_truth: compileItem.compiled_truth,
        });
        if (compileItem.timeline_entry) {
          engine.addTimelineEntry(finalSlug, {
            date: new Date().toISOString().slice(0, 10),
            source: "compile",
            summary: compileItem.timeline_entry,
          });
        }
        if (embedding) {
          engine.upsertChunks(finalSlug, [{
            chunk_index: 0,
            chunk_text: compileItem.compiled_truth.slice(0, 8000),
            chunk_source: "compiled_truth",
            embedding,
          }]);
        }
        engine.deletePage(item.slug);
        created++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${item.slug}] DB write failed: ${msg}`);
      process.stderr.write(`  ✗ DB error: ${msg}\n`);
    }
    processedCount++;
  }

  process.removeListener("SIGINT", sigintHandler);

  return { processed: processedCount, created, updated, noise, errors };
}

// ── CLI command ────────────────────────────────────────────────────────────

export default defineCommand({
  meta: { name: "compile", description: "Run LLM pipeline: inbox items → structured knowledge pages" },
  args: {
    db:          { type: "string",  description: "Path to brain.db" },
    limit:       { type: "string",  description: "Max items to process (default: 20)", default: "20" },
    yes:         { type: "boolean", description: "Skip per-item confirmation (non-interactive)", default: false },
    interactive: { type: "boolean", description: "Review each item before writing", default: false },
  },
  async run({ args }) {
    const limit = parseInt(String(args.limit), 10);
    if (isNaN(limit) || limit <= 0) {
      console.error("✗ --limit must be a positive integer");
      process.exit(1);
    }

    const result = await runCompile({
      dbPath: args.db,
      limit,
      yes: args.yes as boolean,
      interactive: args.interactive as boolean,
    });

    if (result.processed === 0) {
      console.log("✓ Inbox is empty. Nothing to compile.");
      return;
    }

    console.log(
      `\nDone: ${result.processed} processed — ` +
      `${result.created} created, ${result.updated} updated, ${result.noise} noise`,
    );
    if (result.errors.length > 0) {
      console.log(`\nErrors (${result.errors.length}) — items preserved in inbox for retry:`);
      for (const e of result.errors) console.log(`  ✗ ${e}`);
    }
  },
});
