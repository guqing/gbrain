# TODOs

## Second importer adapter validation

- **What:** Implement a second importer adapter after `import-chatgpt` to prove the framework is actually source-agnostic.
- **Why:** A generic importer framework is only real after a second adapter reuses it without ChatGPT-specific leakage.
- **Pros:** Validates runner boundaries, checkpoint model, and retrieval contracts under a different source shape.
- **Cons:** Touches parsing logic, source-specific mapping, and may expose abstractions that looked fine with only one adapter.
- **Context:** v0.5 builds the shared importer platform now, but only ships one adapter. The next adapter should intentionally stress the same runner and file/provenance model.
- **Depends on / blocked by:** v0.6 file extraction pipeline (ContentExtractor interface provides the right pattern to follow for importer adapters too).

## PDF OCR fallback (v0.6.1)

- **What:** When PDF text extraction yields 0 chunks (scanned-image PDFs), attempt OCR via tesseract.js.
- **Why:** Users attaching scanned PDFs get 0 chunks with no explanation — silent failure, bad experience.
- **Pros:** Covers scanned documents and book-scan PDFs; reuses v0.6 ContentExtractor interface (OcrExtractor adapter).
- **Cons:** tesseract.js is ~50MB WASM; accuracy depends on image quality; complex layouts often produce garbled text.
- **Context:** v0.6 PDFExtractor should warn the user when extraction yields 0 text ("PDF appears to be scanned — OCR support coming"). This TODO implements the OCR fallback.
- **Depends on / blocked by:** v0.6 file extraction pipeline.

## Large audio file chunked upload (v0.6.1)

- **What:** When audio exceeds Whisper API's 25MB limit, split with ffmpeg, transcribe in segments, merge time-stamped chunks.
- **Why:** Meeting recordings are commonly 50–200MB. Current behavior: clear error. Should be automatic.
- **Pros:** Unlocks long recordings; ffmpeg pipe pattern already established in v0.6 video.ts.
- **Cons:** Timestamp offset calculation across split boundaries; sentence truncation at split edges.
- **Context:** v0.6 AudioExtractor should throw a clear error for >25MB: "file exceeds Whisper 25MB limit — chunked upload support coming in v0.6.1". This TODO implements the chunking.
- **Depends on / blocked by:** v0.6 AudioExtractor.

## Implement Layer 1+2 test plan (v0.7)

- **What:** Write the 15 unit tests defined in the design doc test plan — `src/test/insight.test.ts` (6 cases) and `src/test/research.test.ts` (9 cases).
- **Why:** Current test coverage for the insight hook and deep research pipeline is 0%. Tests are part of the spec, not an afterthought.
- **Pros:** Catches synthesis timeout crash (critical gap), evaluateAndExtract fallback, TTY guard, Exa API failure handling. All 15 cases use `globalThis.fetch` monkey-patch — no real API calls needed.
- **Cons:** ~2h setup. Must be done before merging v0.7 to main.
- **Context:** Design doc section 9 ("Test Plan") has exact test names, mock patterns, and assertions. The synthesis `llmCall` timeout path was identified as a critical gap — if not covered, it crashes silently.
- **Depends on / blocked by:** Layer 1 + Layer 2 implementation (insight.ts, commands/research.ts, core/research.ts).

## research/ slug prefix for research reports (v0.7 or v0.8)

- **What:** Store deep research reports at `research/timestamp-hash` instead of `inbox/timestamp-hash` so they're distinguishable from regular put entries.
- **Why:** Currently `exo compile` and `exo query` can't tell which content came from research reports vs regular puts. A slug prefix enables filtering.
- **Pros:** Enables `exo query --source=research` in the future; makes inbox cleaner.
- **Cons:** Slight change to `generateInboxSlug` call pattern; all existing research outputs would stay in inbox (no migration needed, just new writes go to the new prefix).
- **Context:** Open Question #1 in design doc. Implementation: pass `research/` prefix into slug generation in `commands/research.ts` instead of using `generateInboxSlug` directly.
- **Depends on / blocked by:** v0.7 research command shipping first.

## useAutoprompt config toggle for Exa (v0.7.1)

- **What:** Add `research.use_autoprompt = false` option to `~/.exo/config.toml` so users can disable Exa's automatic query rewriting.
- **Why:** Exa's `useAutoprompt: true` rewrites the query before searching, which usually helps but sometimes changes direction unexpectedly (e.g., a precise technical query gets softened).
- **Pros:** Gives power users full control over search fidelity; easy to add — one config key + one `if` in the Exa fetch call.
- **Cons:** Most users won't need it. Default behavior (`true`) is usually better for discovery.
- **Context:** Open Question #3 in design doc. Implementation: read `config.research?.use_autoprompt ?? true` in `deepResearch()` and pass to Exa `useAutoprompt` field.
- **Depends on / blocked by:** v0.7 research command shipping first.

## Fix exo query snippet quality (v0.6.3)

- **What:** Fix the snippet displayed for each query result so it shows the content *around* the matched terms, not just the first 120 chars of the chunk. Also split page chunks at `---` boundaries so compiled_truth and timeline content never appear in the same snippet.
- **Why:** `exo query 'redis 限流'` shows snippets like `...多级缓存 - …限流… --- # 四、…Redis… 过期策略` — the `---` separator leaks in, and the matched term often appears near the end of the snippet not near the start. This makes results feel unreadable.
- **Pros:** Pure quality fix, no new commands or deps. Immediately improves every user's query experience.
- **Cons:** Chunk boundary fix needs to re-chunk existing pages in the DB, or at minimum re-chunk on next compile run.
- **Implementation:**
  - `src/commands/query.ts:157`: Find first occurrence of any query term in `chunk_text`, show 60 chars before + 200 chars after (with leading/trailing `…`). Fall back to start of chunk if no term found.
  - `src/core/sqlite-engine.ts` `upsertChunks`: Split page content at `---` boundaries before chunking so compiled_truth and timeline are in separate chunks.
  - Add `--type <session|page|file>` flag to query command for type filtering.

## Web UI — 极简本地知识库浏览器（v0.7）

- **What:** `exo ui` 命令启动本地 HTTP 服务（端口 7499），在浏览器中提供实时搜索 + 结果浏览。前端是单文件内嵌 HTML，零构建步骤。
- **Why:** CLI 显示有上限——结果截断、无法翻页、无法看全文。Web UI 解决"搜索结果太零散"的问题，让结果可读可浏览。首要目标是自己用，不是 demo。
- **Architecture:** `exo ui` 是独立命令，不改 `exo serve`（MCP stdio 保持独立）。后端用 `Bun.serve()` 原生 HTTP，不引入 Hono。前端代码内嵌在 `src/ui/html.ts` 的字符串常量里，打包后随 binary 分发，无需单独构建。
- **API endpoints（新建在 `src/commands/ui.ts`）:**
  - `GET /api/search?q=&type=page|session|inbox&limit=` → `engine.hybridSearch()`
  - `GET /api/page/:slug` → 返回完整页面内容
- **前端功能：**
  - Tab 过滤：All / Pages / Sessions / Files（Files 在客户端按 `result_kind` 过滤）
  - 相对分数条（score / maxScore）直观显示相关性差距
  - 完整 snippet，不截断
  - 点击结果 inline 展开全文（调用 `/api/page/:slug`）
  - 实时搜索，debounce 300ms
- **完整 spec：** `docs/v0.7-web-ui-and-search-fix.md`

## Entity detection + auto-linking (v0.8)

- **What:** When running `exo put`, `exo capture`, or `exo compile`, automatically detect named entities (people, companies, technologies) in the text and suggest or auto-create linked pages, with back-links.
- **Why:** This is the mechanism that makes a knowledge graph grow organically. From gbrain research: gbrain runs entity detection as a sub-agent on every write. Over time, every mention of "Redis" links to a Redis page, every mention of a person links to their profile page.
- **Pros:** Knowledge graph emerges naturally without manual work. Backlinks become valuable over time. Core to the "external brain" vision.
- **Cons:** Requires LLM call on every write (latency + cost). Entity disambiguation is hard (is "Redis" the database or a company name?). Need user confirmation flow to avoid unwanted auto-creation.
- **Implementation sketch:** After compile/put, run a cheap LLM call (gpt-4.1-mini) to extract entities from new content. Check if entity pages exist. If not, offer to create stub pages. Write back-link to source page's timeline.

## exo maintain / dream cycle (v0.8)

- **What:** A maintenance command that runs a batch of health-check and repair tasks: embed stale chunks, detect orphaned files (file exists but no page references it), detect thin pages (compiled truth under 100 chars), fix broken internal links, citation audit.
- **Why:** From gbrain research: the "dream cycle" is a nightly maintenance pass that keeps the brain healthy automatically. exo has `exo doctor` for diagnostics, but no equivalent that *fixes* problems proactively.
- **Pros:** Can be scheduled via cron (`0 2 * * * exo maintain`). Keeps the database clean. Surfaces pages that need attention.
- **Cons:** LLM calls for thin page detection. Could be slow on large databases.
- **Implementation:** New command `exo maintain` (alias: `exo dream`). Steps: (1) embed all un-embedded chunks, (2) list orphaned files, (3) list thin pages, (4) detect broken `[[slug]]` links, (5) output a health report.

## Source attribution enforcement in compile (v0.8)

- **What:** When `exo compile` generates compiled truth, enforce the `[Source: who, context, date]` format in the LLM system prompt so every factual claim has a citation.
- **Why:** From gbrain research: source attribution is what separates a knowledge base from a pile of notes. When you later read compiled truth and wonder "where did this come from?", the citation tells you.
- **Pros:** Increases knowledge quality and trust. Low-effort change — just update the compile system prompt.
- **Cons:** Makes compiled truth longer. LLMs sometimes resist per-fact citation formatting.

## Two-stage cross-encoder reranker (v0.9)

- **What:** Add an optional second-stage reranker after hybrid BM25F+vector retrieval. Retrieve top-30 candidates, then score each with a lightweight cross-encoder model (ONNX runtime, runs locally, no API cost) to get query-aware relevance scores. Chinese-compatible models: `cross-encoder/ms-marco-MiniLM-L-6-v2` (English) or a bilingual model via HuggingFace.
- **Why:** v0.8 BM25F title weighting + RRF title bonus raised MRR@10 from 0.771 → 0.917, but Q1 "redis 限流" still lands at rank 3. The target "统计API调用次数" is a body-match case — the query terms appear in the page body, not the title. Cross-encoder reranking is the standard solution for body-match precision: it reads the full (query, document) pair and scores semantic relevance, not keyword overlap.
- **Expected impact:** MRR@10 0.917 → ~0.95+. Body-match queries get the same treatment as title-match queries.
- **Implementation sketch:**
  1. Download ONNX cross-encoder model to `~/.exo/models/` on first use (lazy download, ~25MB)
  2. In `hybridSearch()`, after RRF fusion, pass top-30 to `rerankWithCrossEncoder(query, results)`
  3. Cross-encoder scores override RRF scores for final sort
  4. Gate behind `config.search.reranker = "cross-encoder"` (default: off until model is validated for Chinese)
- **Open questions:** Best bilingual (Chinese + English) cross-encoder for personal KB queries? Chinese support needs empirical validation — run eval framework before shipping.
- **Depends on / blocked by:** onnxruntime-node or @xenova/transformers available in Bun environment.

## Originals folder / exo capture --original (v0.9)

- **What:** A dedicated space for capturing the user's own original thinking, separate from information collected from external sources. `exo capture --original "my insight here"` stores to `originals/` slug prefix with an "originality" marker in metadata.
- **Why:** From gbrain research: the originals folder captures WHAT YOU THINK, not just what you found. Over time it becomes a record of your intellectual development. Most knowledge tools store external info; few help you capture and develop your own ideas.
- **Pros:** Differentiates personal brain from search index. Creates a "what I believe" layer separate from "what I've read".
- **Cons:** Subjective concept. What counts as "original"? Need clear UX for what goes here vs regular capture.

## Deterministic collector recipe docs (v0.9)

- **What:** Write a recipe/guide showing how to build integrations that feed data into exo using the "deterministic collector" pattern: write a script that collects data deterministically (no LLM), outputs markdown, and pipes into `exo import` or `exo put`.
- **Why:** From gbrain research: gbrain's philosophy is "code for data, LLMs for judgment." This pattern makes it easy for the community to build email/calendar/X/RSS integrations without needing to modify exo core. The guide would show examples: a Python script that fetches recent Gmail → `exo put`, a Node script that syncs Google Calendar events → `exo import`.
- **Pros:** Unlocks community-built integrations without maintaining them in core. Low effort — just docs and example scripts.
- **Cons:** Docs need maintenance as exo API changes.

## Completed

### v0.6 PDF / OCR ingestion
- **What:** Add PDF text extraction and OCR so imported PDFs become searchable content, not just generic attachments.
- **Completed:** v0.6.0.0 (2026-04-11) — PdfExtractor (unpdf), per-page chunking, FTS5 indexing.

### Audio / video transcript ingestion
- **What:** Add transcript extraction for audio and video attachments so media becomes searchable text.
- **Completed:** v0.6.0.0 (2026-04-11) — AudioExtractor (Whisper API), VideoExtractor (ffmpeg → wav pipe).
