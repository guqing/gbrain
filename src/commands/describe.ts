import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { loadConfig } from "../core/config.ts";
import { getFilesDir, isImageMime } from "../core/files.ts";
import { processFileContent, describeAndEmbedFile } from "../core/file-processing.ts";
import { registry } from "../core/extractors/index.ts";

export default defineCommand({
  meta: {
    name: "describe",
    description: "Extract and embed content from files (images, PDFs, DOCX, audio, video)",
  },
  args: {
    "file-slug": {
      type: "positional",
      description: "File slug to process (omit with --all)",
      required: false,
    },
    all: {
      type: "boolean",
      description: "Process all unprocessed files",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Re-process already-processed files",
      default: false,
    },
    "max-files": {
      type: "string",
      description: "Maximum number of files to process (used with --all)",
    },
    concurrency: {
      type: "string",
      description: "Parallel processing requests (default: 5)",
    },
    yes: {
      type: "boolean",
      description: "Skip TTY confirmation prompt",
      default: false,
    },
    db: { type: "string", description: "Path to brain.db" },
  },
  async run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const cfg = loadConfig();
    const filesDir = getFilesDir();

    if (!cfg.vision?.api_key) {
      console.error("✗ Vision API not configured. Set with: gbrain config set vision.api_key <key>");
      process.exit(1);
    }

    const concurrency = parseInt(args.concurrency ?? "5", 10);

    if (args.all) {
      let candidates = args.force
        ? engine.listFiles().filter(f => registry.supports(f.mime_type) || isImageMime(f.mime_type))
        : engine.listUnprocessedFiles().filter(f => registry.supports(f.mime_type) || isImageMime(f.mime_type));

      if (args["max-files"]) {
        const maxFiles = parseInt(args["max-files"], 10);
        candidates = candidates.slice(0, maxFiles);
      }

      if (candidates.length === 0) {
        console.log("No file candidates to process.");
        return;
      }

      const totalFiles = engine.listFiles().filter(f => registry.supports(f.mime_type) || isImageMime(f.mime_type)).length;
      const skipped = totalFiles - candidates.length;
      console.log(`${candidates.length} file candidate(s)${skipped > 0 ? `, ${skipped} skipped` : ""}`);

      // Confirm in TTY if not --yes
      if (process.stdout.isTTY && !args.yes) {
        process.stdout.write(`Process ${candidates.length} file(s)? [y/N] `);
        const answer = await new Promise<string>((resolve) => {
          process.stdin.setEncoding("utf-8");
          process.stdin.once("data", (d) => resolve(String(d).trim().toLowerCase()));
        });
        if (answer !== "y" && answer !== "yes") {
          console.log("Aborted.");
          return;
        }
      }

      let completed = 0;
      let failed = 0;
      let interrupted = false;
      const handleSigint = () => { interrupted = true; };
      process.on("SIGINT", handleSigint);

      const total = candidates.length;

      // Process in batches of concurrency
      for (let i = 0; i < candidates.length; i += concurrency) {
        if (interrupted) break;
        const batch = candidates.slice(i, i + concurrency);
        await Promise.all(batch.map(async (f) => {
          if (interrupted) return;
          const result = await processFileContent(engine, f.slug, filesDir, {
            visionCfg: cfg.vision!,
            transcriptionBaseUrl: cfg.transcription?.base_url,
            transcriptionApiKey: cfg.transcription?.api_key ?? cfg.vision?.api_key,
          });
          if (result.embedded) {
            completed++;
          } else {
            failed++;
          }

          // Progress line
          const done = completed + failed;
          if (process.stdout.isTTY) {
            process.stdout.write(`\rProcessing ${done}/${total}...  `);
          } else if (done % 10 === 0) {
            console.log(`Processing ${done}/${total}...`);
          }
        }));
      }

      process.off("SIGINT", handleSigint);
      if (process.stdout.isTTY) process.stdout.write("\n");

      if (interrupted) {
        console.log(`Interrupted after ${completed + failed}/${total}. Resume with: gbrain describe --all`);
      } else {
        console.log(`✓ Processed ${completed} file(s), ${failed} failed, ${total - completed - failed} skipped`);
        if (failed > 0) {
          console.log("  Next: gbrain describe --all  (retries failed files)");
        }
      }
      return;
    }

    // Single file mode
    const fileSlug = args["file-slug"];
    if (!fileSlug) {
      console.error("✗ Provide a file-slug or use --all");
      process.exit(1);
    }

    const file = engine.getFile(fileSlug);
    if (!file) {
      console.error(`✗ File not found: ${fileSlug}`);
      process.exit(1);
    }

    if (!registry.supports(file.mime_type) && !isImageMime(file.mime_type)) {
      console.error(`✗ ${fileSlug} has unsupported MIME type: ${file.mime_type}`);
      process.exit(1);
    }

    if (file.processed_at && !args.force) {
      console.log(`· Already processed. Use --force to re-process.`);
      return;
    }

    console.log(`Processing ${fileSlug}...`);
    const result = await processFileContent(engine, fileSlug, filesDir, {
      visionCfg: cfg.vision!,
      transcriptionBaseUrl: cfg.transcription?.base_url,
      transcriptionApiKey: cfg.transcription?.api_key ?? cfg.vision?.api_key,
    });

    if (result.warning && !result.embedded) {
      console.error(`✗ Processing failed: ${result.warning}`);
      process.exit(1);
    }

    if (result.warning) {
      console.warn(`⚠ ${result.warning}`);
    }

    const updatedFile = engine.getFile(fileSlug);
    const previewText = updatedFile?.description ?? "";
    console.log(`✓ Processed ${fileSlug}: ${result.chunks_stored} chunk(s) stored`);
    if (previewText) {
      console.log(`  "${previewText.slice(0, 60)}${previewText.length > 60 ? "..." : ""}"`);
      const firstWords = previewText.split(/\s+/).slice(0, 3).join(" ");
      console.log(`  Next: gbrain search "${firstWords}"`);
    }
  },
});

