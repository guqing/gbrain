/**
 * Tests for v0.6 ExtractorRegistry and AudioExtractor.
 *
 * PdfExtractor and DocumentExtractor depend on unpdf/mammoth which are not
 * installed in the test environment. They are covered by integration tests
 * (see TODOS.md v0.6.1).
 *
 * ImageExtractor wraps describeImage which requires a live Vision API.
 * AudioExtractor has an injectable fetchFn so it's fully testable here.
 */

import { describe, test, expect } from "bun:test";
import { ExtractorRegistry } from "../core/extractors/index.ts";
import { AudioExtractor } from "../core/extractors/audio.ts";
import { PdfExtractor } from "../core/extractors/pdf.ts";
import { DocumentExtractor } from "../core/extractors/document.ts";
import { VideoExtractor } from "../core/extractors/video.ts";
import { ImageExtractor } from "../core/extractors/image.ts";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// ── ExtractorRegistry ─────────────────────────────────────────────────────────

describe("ExtractorRegistry", () => {
  test("returns correct extractor for known MIME types", () => {
    const reg = new ExtractorRegistry();
    reg.register(new PdfExtractor());
    reg.register(new DocumentExtractor());
    reg.register(new AudioExtractor());
    reg.register(new VideoExtractor());
    reg.register(new ImageExtractor());

    expect(reg.get("application/pdf")).toBeInstanceOf(PdfExtractor);
    expect(reg.get("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeInstanceOf(DocumentExtractor);
    expect(reg.get("audio/mpeg")).toBeInstanceOf(AudioExtractor);
    expect(reg.get("audio/mp3")).toBeInstanceOf(AudioExtractor);
    expect(reg.get("audio/wav")).toBeInstanceOf(AudioExtractor);
    expect(reg.get("audio/x-m4a")).toBeInstanceOf(AudioExtractor);
    expect(reg.get("video/mp4")).toBeInstanceOf(VideoExtractor);
    expect(reg.get("video/webm")).toBeInstanceOf(VideoExtractor);
    expect(reg.get("image/jpeg")).toBeInstanceOf(ImageExtractor);
    expect(reg.get("image/png")).toBeInstanceOf(ImageExtractor);
  });

  test("returns null for unsupported MIME types", () => {
    const reg = new ExtractorRegistry();
    reg.register(new PdfExtractor());

    expect(reg.get("application/zip")).toBeNull();
    expect(reg.get("text/plain")).toBeNull();
    expect(reg.get("application/octet-stream")).toBeNull();
  });

  test("supports() returns true for registered MIME types", () => {
    const reg = new ExtractorRegistry();
    reg.register(new PdfExtractor());

    expect(reg.supports("application/pdf")).toBe(true);
    expect(reg.supports("application/zip")).toBe(false);
  });

  test("first registered extractor wins on MIME conflict", () => {
    const reg = new ExtractorRegistry();
    const first = new PdfExtractor();
    const second = new PdfExtractor();
    reg.register(first);
    reg.register(second);

    // Should return the first one registered
    expect(reg.get("application/pdf")).toBe(first);
  });

  test("empty registry returns null for any MIME", () => {
    const reg = new ExtractorRegistry();
    expect(reg.get("application/pdf")).toBeNull();
    expect(reg.supports("application/pdf")).toBe(false);
  });
});

// ── AudioExtractor ────────────────────────────────────────────────────────────

describe("AudioExtractor.supports()", () => {
  const extractor = new AudioExtractor();

  test.each([
    ["audio/mpeg", true],
    ["audio/mp3", true],
    ["audio/mp4", true],
    ["audio/wav", true],
    ["audio/wave", true],
    ["audio/ogg", true],
    ["audio/flac", true],
    ["audio/webm", true],
    ["audio/x-m4a", true],
    ["video/mp4", false],
    ["application/pdf", false],
    ["image/png", false],
  ])("supports(%s) === %s", (mime, expected) => {
    expect(extractor.supports(mime)).toBe(expected);
  });
});

describe("AudioExtractor.extract()", () => {
  // Create a minimal real wav file (44 bytes: header only) for stat() to work
  async function makeTinyWav(): Promise<string> {
    const path = join(tmpdir(), `test-audio-${randomBytes(4).toString("hex")}.wav`);
    // Minimal valid WAV header (44 bytes, 0 audio data)
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36, 4);        // chunk size
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);       // subchunk1 size
    header.writeUInt16LE(1, 20);        // PCM
    header.writeUInt16LE(1, 22);        // mono
    header.writeUInt32LE(16000, 24);    // sample rate
    header.writeUInt32LE(32000, 28);    // byte rate
    header.writeUInt16LE(2, 32);        // block align
    header.writeUInt16LE(16, 34);       // bits per sample
    header.write("data", 36);
    header.writeUInt32LE(0, 40);        // subchunk2 size
    await writeFile(path, header);
    return path;
  }

  test("throws when no API key provided", async () => {
    const extractor = new AudioExtractor();
    const path = await makeTinyWav();
    try {
      await expect(
        extractor.extract(path, { transcriptionApiKey: undefined })
      ).rejects.toThrow("transcriptionApiKey required");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  test("returns transcript chunk on successful API call", async () => {
    const extractor = new AudioExtractor();
    const path = await makeTinyWav();

    const mockFetch = async (_url: string, _opts: RequestInit): Promise<Response> => {
      return new Response("Hello world transcript", { status: 200 });
    };

    try {
      const chunks = await extractor.extract(path, {
        transcriptionApiKey: "test-key",
        transcriptionBaseUrl: "https://api.openai.com",
        fetchFn: mockFetch as typeof fetch,
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.text).toBe("Hello world transcript");
      expect(chunks[0]!.source).toBe("transcript");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  test("returns empty array when API returns empty transcript", async () => {
    const extractor = new AudioExtractor();
    const path = await makeTinyWav();

    const mockFetch = async (_url: string, _opts: RequestInit): Promise<Response> => {
      return new Response("   ", { status: 200 }); // whitespace only
    };

    try {
      const chunks = await extractor.extract(path, {
        transcriptionApiKey: "test-key",
        fetchFn: mockFetch as typeof fetch,
      });

      expect(chunks).toHaveLength(0);
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  test("throws descriptive error when API returns non-200", async () => {
    const extractor = new AudioExtractor();
    const path = await makeTinyWav();

    const mockFetch = async (_url: string, _opts: RequestInit): Promise<Response> => {
      return new Response("Invalid audio", { status: 400 });
    };

    try {
      await expect(
        extractor.extract(path, {
          transcriptionApiKey: "test-key",
          fetchFn: mockFetch as typeof fetch,
        })
      ).rejects.toThrow("Whisper API error 400");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  test("throws when file does not exist", async () => {
    const extractor = new AudioExtractor();
    await expect(
      extractor.extract("/nonexistent/path/audio.wav", {
        transcriptionApiKey: "test-key",
      })
    ).rejects.toThrow("Failed to read audio file");
  });
});

// ── PdfExtractor.supports() ───────────────────────────────────────────────────

describe("PdfExtractor.supports()", () => {
  const extractor = new PdfExtractor();

  test("supports application/pdf", () => {
    expect(extractor.supports("application/pdf")).toBe(true);
  });

  test("does not support non-PDF MIME types", () => {
    expect(extractor.supports("application/msword")).toBe(false);
    expect(extractor.supports("image/png")).toBe(false);
    expect(extractor.supports("text/plain")).toBe(false);
  });
});

// ── DocumentExtractor.supports() ─────────────────────────────────────────────

describe("DocumentExtractor.supports()", () => {
  const extractor = new DocumentExtractor();

  test("supports docx and doc MIME types", () => {
    expect(extractor.supports("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(extractor.supports("application/msword")).toBe(true);
  });

  test("does not support non-document MIME types", () => {
    expect(extractor.supports("application/pdf")).toBe(false);
    expect(extractor.supports("image/png")).toBe(false);
  });
});

describe("DocumentExtractor.extract() — .doc rejection", () => {
  test("throws for .doc files (legacy format not supported)", async () => {
    const extractor = new DocumentExtractor();
    await expect(
      extractor.extract("/some/file.doc")
    ).rejects.toThrow("Legacy .doc format is not supported");
  });
});

// ── VideoExtractor.supports() ─────────────────────────────────────────────────

describe("VideoExtractor.supports()", () => {
  const extractor = new VideoExtractor();

  test.each([
    ["video/mp4", true],
    ["video/webm", true],
    ["video/quicktime", true],
    ["video/x-msvideo", true],
    ["video/x-matroska", true],
    ["video/mpeg", true],
    ["video/ogg", true],
    ["audio/mpeg", false],
    ["application/pdf", false],
  ])("supports(%s) === %s", (mime, expected) => {
    expect(extractor.supports(mime)).toBe(expected);
  });
});
