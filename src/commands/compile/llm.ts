import type { ExoConfig } from "../../core/config.ts";
import type { CompileItem } from "../../types.ts";

export interface CompileConfig {
  base_url?: string;
  api_key?: string;
  model?: string;
}

const SYSTEM_PROMPT = `You are a personal knowledge brain maintainer.
You receive a raw note (inbox item) and a list of existing concept pages.
Your job: determine if this note should CREATE a new concept page, UPDATE an existing one, or is NOISE.

Rules:
- NOISE: the note is too vague, a reminder, or purely conversational with no durable knowledge.
- UPDATE: the note substantially relates to an existing CONCEPT page (similar topic). Merge new insights.
- CREATE: the note contains durable knowledge not yet covered by existing pages. Suggest a kebab-case slug.

IMPORTANT: Only session/raw notes are given to you. The update candidates shown are concept pages only.
Never suggest updating a page that doesn't exist in the candidates list.

When writing compiled_truth, PRESERVE:
- Specific code snippets, CSS values, function names, version numbers
- Concrete "how to" steps and gotchas (e.g. "outline: 2px solid #fff; outline-offset: 8px")
- The actual solution, not just a description of the category ("use outline not box-shadow")
Avoid abstracting away actionable details into generic category descriptions.

Return ONLY valid JSON matching this schema (no markdown, no extra text):
{ "action": "create"|"update"|"noise", "slug": string|null, "title": string|null, "compiled_truth": string, "timeline_entry": string|null, "reasoning": string }`;

export type FetchFn = typeof fetch;

/**
 * Call the LLM compile endpoint. Returns a parsed CompileItem.
 * Throws on timeout, network error, or invalid JSON/schema.
 *
 * @param inboxContent - raw inbox item text
 * @param existingPages - top similar pages for context [{slug, title}]
 * @param config - compile config (api_key, base_url, model)
 * @param fetchFn - injectable for testing (default: global fetch)
 */
export async function callLlm(
  inboxContent: string,
  existingPages: Array<{ slug: string; title: string }>,
  config: ExoConfig["compile"],
  fetchFn: FetchFn = fetch,
): Promise<CompileItem> {
  const apiKey = config.api_key;
  if (!apiKey) {
    throw new Error(
      "compile.api_key is not set. Run: exo config set compile.api_key <key>",
    );
  }

  const baseUrl = config.base_url ?? "https://api.openai.com/v1";
  const model = config.model ?? "gpt-4.1-mini";

  const pagesContext =
    existingPages.length > 0
      ? existingPages.map((p) => `- ${p.slug}: ${p.title}`).join("\n")
      : "(no existing pages)";

  const userPrompt = `<existing_pages>\n${pagesContext}\n</existing_pages>\n\n<user_content>\n${inboxContent}\n</user_content>`;

  // Dynamic timeout: large inputs (>2000 chars) get 90s, others get 30s
  const timeoutMs = inboxContent.length > 2000 ? 90_000 : 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "claude-code/1.0",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        // Dynamic max_tokens: larger input needs larger output budget for summarization
        max_tokens: Math.min(4096, Math.max(1024, Math.ceil(inboxContent.length / 4))),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("LLM timeout (30s exceeded)");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("LLM returned empty response");

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  // Schema validation
  const action = parsed["action"];
  if (action !== "create" && action !== "update" && action !== "noise") {
    throw new Error(`LLM returned unknown action: ${action}`);
  }
  // noise items don't need compiled_truth
  const compiled_truth = String(parsed["compiled_truth"] ?? "");
  if (action !== "noise" && !compiled_truth) throw new Error("LLM returned empty compiled_truth");

  return {
    action: action as CompileItem["action"],
    slug: parsed["slug"] ? String(parsed["slug"]) : undefined,
    title: parsed["title"] ? String(parsed["title"]) : undefined,
    compiled_truth,
    timeline_entry: parsed["timeline_entry"] ? String(parsed["timeline_entry"]) : undefined,
    reasoning: parsed["reasoning"] ? String(parsed["reasoning"]) : undefined,
  };
}
