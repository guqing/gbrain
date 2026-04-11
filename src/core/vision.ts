// Injectable fetch — same pattern as src/commands/compile/llm.ts
export type FetchFn = typeof fetch;

export interface VisionConfig {
  base_url?: string;
  api_key?: string;
  model: string;
}

/**
 * Generate a text description of an image using a vision-capable LLM.
 * Throws on timeout, network error, or non-200 response.
 */
export async function describeImage(
  base64Data: string,
  mimeType: string,
  cfg: VisionConfig,
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const baseUrl = (cfg.base_url ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = cfg.model;
  const apiKey = cfg.api_key;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image in 2-3 sentences. Focus on the main subject, key visual elements, and any text visible. Be specific and informative — this description will be used as searchable text.",
              },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64Data}` },
              },
            ],
          },
        ],
        max_tokens: 300,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new Error(`Vision API authentication failed (401). Check vision.api_key in config.`);
      }
      throw new Error(`Vision API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Vision API returned empty content");
    return content.trim();
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Vision API timeout (60s exceeded)");
    }
    throw err;
  }
}
