import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { AudioExtractor } from "./audio.ts";
import type { ContentChunk, ContentExtractor, ExtractOpts } from "./interface.ts";

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/mpeg",
  "video/ogg",
]);

export class VideoExtractor implements ContentExtractor {
  private audioExtractor = new AudioExtractor();

  supports(mimeType: string): boolean {
    return VIDEO_MIMES.has(mimeType);
  }

  async extract(filePath: string, opts?: ExtractOpts): Promise<ContentChunk[]> {
    const tmpPath = join(tmpdir(), `gbrain-audio-${randomBytes(8).toString("hex")}.wav`);

    try {
      await this.extractAudioTrack(filePath, tmpPath);
    } catch (err) {
      throw err; // already descriptive from extractAudioTrack
    }

    try {
      // AudioExtractor reads the temp wav file directly — no need to buffer it here.
      const audioChunks = await this.audioExtractor.extract(tmpPath, {
        ...opts,
        // Override MIME so AudioExtractor accepts the wav file
      });
      return audioChunks;
    } finally {
      await unlink(tmpPath).catch(() => {}); // always clean up
    }
  }

  private extractAudioTrack(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let ffmpeg: ReturnType<typeof spawn>;
      try {
        ffmpeg = spawn("ffmpeg", [
          "-i", videoPath,
          "-vn",            // no video
          "-acodec", "pcm_s16le",
          "-ar", "16000",   // 16kHz — Whisper optimal
          "-ac", "1",       // mono
          "-f", "wav",
          "-y",             // overwrite output
          outputPath,
        ], { stdio: ["ignore", "ignore", "pipe"] });
      } catch (err) {
        const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "ffmpeg not installed. Install it: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
          : `Failed to spawn ffmpeg: ${(err as Error).message}`;
        return reject(new Error(msg));
      }

      let stderrOutput = "";
      ffmpeg.stderr?.on("data", (data: Buffer) => {
        stderrOutput += data.toString();
      });

      ffmpeg.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          reject(new Error(
            "ffmpeg not installed. Install it: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
          ));
        } else {
          reject(new Error(`ffmpeg error: ${err.message}`));
        }
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code} for ${videoPath}. stderr: ${stderrOutput.slice(-500)}`));
        } else {
          resolve();
        }
      });
    });
  }
}
