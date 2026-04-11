import { defineCommand } from "citty";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "fs";
import { basename, extname, join } from "path";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { loadConfig } from "../core/config.ts";
import { fileHash, getMimeType, isImageMime, baseSlug, resolveFileSlug, getFilesDir } from "../core/files.ts";
import { describeAndEmbedFile } from "../core/file-processing.ts";

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
      description: "Generate an AI description for the file (images only)",
      default: false,
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
      console.error(`✗ Description is only supported for image/* files in v0.5 (got ${mime})`);
      process.exit(1);
    }

    if (args.describe && !cfg.vision?.api_key) {
      console.error("✗ Vision API not configured. Set api_key with: gbrain config set vision.api_key <key>");
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
    let described = false;
    let descriptionWarning: string | null = null;

    if (attachResult.isDuplicate) {
      // Remove the redundant copy we just made; the existing file on disk is canonical.
      rmSync(diskPath, { force: true });
      console.log(`· File already exists as ${finalSlug}, linked to page`);
    }

    if (args.describe && isImageMime(mime)) {
      process.stdout.write(`Describing ${finalSlug}...\n`);
      const result = await describeAndEmbedFile(
        engine,
        finalSlug,
        filesDir,
        cfg.vision!,
        cfg.embed.model,
      );
      described = result.described;
      if (result.warning) {
        descriptionWarning = result.warning;
        console.warn(`⚠ Vision API failed: ${result.warning}. Attached without description.`);
        console.warn(`  Run: gbrain describe ${finalSlug}`);
      }
    }

    if (args.json) {
      const nextAction = isImageMime(mime) && !described
        ? `gbrain describe ${finalSlug}`
        : null;
      // For duplicates, the canonical file_path is the one already in the DB.
      const actualFilePath = attachResult.isDuplicate
        ? (engine.getFile(finalSlug)?.file_path ?? relPath)
        : relPath;
      console.log(JSON.stringify({
        slug: finalSlug,
        page_slug: pageSlug,
        file_path: actualFilePath,
        mime_type: mime,
        described,
        description_warning: descriptionWarning,
        next_action: nextAction,
      }, null, 2));
    } else {
      console.log(`✓ Attached ${finalSlug}${ext} to ${pageSlug}`);
      if (isImageMime(mime) && !described) {
        console.log(`  Next: gbrain describe ${finalSlug}`);
      }
    }
  },
});
