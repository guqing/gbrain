import { readFile, stat } from "node:fs/promises";
import type { ContentChunk, ContentExtractor, ExtractOpts } from "./interface.ts";

const AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/wave",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
  "audio/x-m4a",
]);

/** 25 MB — Whisper API hard limit */
const WHISPER_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;

export class AudioExtractor implements ContentExtractor {
  supports(mimeType: string): boolean {
    return AUDIO_MIMES.has(mimeType);
  }

  async extract(filePath: string, opts?: ExtractOpts): Promise<ContentChunk[]> {
    const fileStat = await stat(filePath).catch(err => {
      throw new Error(`Failed to read audio file at ${filePath}: ${(err as Error).message}`);
    });

    if (fileStat.size > WHISPER_SIZE_LIMIT_BYTES) {
      throw new Error(
        `Audio file too large for Whisper API: ${filePath} is ${Math.round(fileStat.size / 1024 / 1024)}MB. ` +
        `Maximum is 25MB. Large audio chunking is tracked in TODOS.md (v0.6.1).`
      );
    }

    const baseUrl = opts?.transcriptionBaseUrl ?? "https://api.openai.com";
    const apiKey = opts?.transcriptionApiKey;
    if (!apiKey) {
      throw new Error("transcriptionApiKey required for audio transcription");
    }

    const audioBuffer = await readFile(filePath).catch(err => {
      throw new Error(`Failed to read audio file at ${filePath}: ${(err as Error).message}`);
    });

    const fetchFn = opts?.fetchFn ?? globalThis.fetch;

    const formData = new FormData();
    const blob = new Blob([audioBuffer]);
    const filename = filePath.split("/").pop() ?? "audio";
    formData.append("file", blob, filename);
    formData.append("model", "whisper-1");
    formData.append("response_format", "text");

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/v1/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
        signal: AbortSignal.timeout(120_000), // 2-minute timeout
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("timeout") || msg.includes("AbortError")) {
        throw new Error(`Whisper API timed out after 2 minutes for ${filePath}`);
      }
      throw new Error(`Whisper API request failed for ${filePath}: ${msg}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Whisper API error ${response.status} for ${filePath}: ${body}`);
    }

    const transcript = (await response.text()).trim();
    if (!transcript) {
      return [];
    }

    return [{ text: transcript, source: "transcript" }];
  }
}
