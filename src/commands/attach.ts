import { defineCommand } from "citty";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "fs";
import { basename, extname, join } from "path";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { loadConfig } from "../core/config.ts";
import { fileHash, getMimeType, isImageMime, baseSlug, resolveFileSlug, getFilesDir } from "../core/files.ts";
import { processFileContent } from "../core/file-processing.ts";

export default defineCommand({
  meta: {
    name: "attach",
    description: "Attach a file to a page",
  },
  args: {
    "page-slug": {
      type: "positional",
      description: "Page slug to attach the file to",
      required: true,
    },
    file: {
      type: "positional",
      description: "Path to the file to attach",
      required: true,
    },
    describe: {
      type: "boolean",
      description: "Generate an AI description for images",
      default: false,
    },
    transcribe: {
      type: "boolean",
      description: "Transcribe audio/video using Whisper API",
      default: false,
    },
    embed: {
      type: "boolean",
      description: "Embed content after extraction (use --no-embed to skip)",
      default: true,
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
    db: { type: "string", description: "Path to brain.db" },
  },
  async run({ args }) {
    const pageSlug = args["page-slug"];
    const filePath = args.file;
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const cfg = loadConfig();

    // Validate page
    if (!engine.getPage(pageSlug)) {
      console.error(`✗ Page not found: ${pageSlug}`);
      process.exit(1);
    }

    // Validate file
    if (!existsSync(filePath)) {
      console.error(`✗ File not found: ${filePath}`);
      process.exit(1);
    }

    const ext = extname(filePath);
    const mime = getMimeType(filePath);
    if (!mime) {
      console.error(`✗ Unsupported file type: ${ext || "(no extension)"}`);
      process.exit(1);
    }

    if (args.describe && !isImageMime(mime)) {
      console.error(`✗ --describe is only supported for image/* files (got ${mime})`);
      process.exit(1);
    }

    if (args.describe && !cfg.vision?.api_key) {
      console.error("✗ Vision API not configured. Set api_key with: exo config set vision.api_key <key>");
      process.exit(1);
    }

    const content = readFileSync(filePath);
    const sha256 = fileHash(content);
    const filesDir = getFilesDir();
    mkdirSync(filesDir, { recursive: true });

    const slug = resolveFileSlug(baseSlug(filePath), ext, filesDir);
    const relPath = `${slug}${ext}`;
    const diskPath = join(filesDir, relPath);
    const stat = statSync(filePath);

    let attachResult: { slug: string; isDuplicate: boolean };
    try {
      copyFileSync(filePath, diskPath);
      attachResult = engine.attachFileRecord(pageSlug, {
        slug,
        sha256,
        file_path: relPath,
        original_name: basename(filePath),
        mime_type: mime,
        size_bytes: stat.size,
        description: null,
        processed_at: null,
      });
    } catch (err) {
      if (String(err).includes("UNIQUE constraint failed: files.slug")) {
        rmSync(diskPath, { force: true });
        console.error(`✗ Slug collision on "${slug}" after file copy — retry`);
        process.exit(1);
      }
      throw err;
    }

    const finalSlug = attachResult.slug;
    let processed = false;
    let processingWarning: string | null = null;

    if (attachResult.isDuplicate) {
      // Remove the redundant copy we just made; the existing file on disk is canonical.
      rmSync(diskPath, { force: true });
      console.log(`· File already exists as ${finalSlug}, linked to page`);
    }

    // Determine whether to auto-extract content
    const isPdf = mime === "application/pdf";
    const isDocx = mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const isAudioVideo = mime.startsWith("audio/") || mime.startsWith("video/");
    const shouldExtract = args.describe || isPdf || isDocx || (isAudioVideo && args.transcribe);

    if (shouldExtract) {
      const fileLabel = isPdf ? "Extracting PDF" : isDocx ? "Extracting DOCX" : isAudioVideo ? "Transcribing" : "Describing";
      process.stdout.write(`${fileLabel} ${finalSlug}...\n`);
      try {
        await processFileContent(engine, finalSlug, filesDir, {
          visionCfg: cfg.vision,
          transcriptionBaseUrl: (cfg.transcription ?? cfg.vision)?.base_url,
          transcriptionApiKey: (cfg.transcription ?? cfg.vision)?.api_key,
          skipEmbed: !args.embed,
        });
        processed = true;
      } catch (err) {
        processingWarning = String(err);
        console.warn(`⚠ Content extraction failed: ${processingWarning}`);
        console.warn(`  Run: exo describe ${finalSlug}`);
      }
    }

    const needsExtract = !processed && (isImageMime(mime) || isPdf || isDocx);

    if (args.json) {
      const nextAction = needsExtract ? `exo describe ${finalSlug}` : null;
      // For duplicates, the canonical file_path is the one already in the DB.
      const actualFilePath = attachResult.isDuplicate
        ? (engine.getFile(finalSlug)?.file_path ?? relPath)
        : relPath;
      console.log(JSON.stringify({
        slug: finalSlug,
        page_slug: pageSlug,
        file_path: actualFilePath,
        mime_type: mime,
        processed,
        processing_warning: processingWarning,
        next_action: nextAction,
      }, null, 2));
    } else {
      console.log(`✓ Attached ${finalSlug}${ext} to ${pageSlug}`);
      if (needsExtract) {
        const hint = isPdf || isDocx ? "extract text with" : "describe with";
        console.log(`  Next: exo describe ${finalSlug}  (${hint} exo describe)`);
      }
    }
  },
});
