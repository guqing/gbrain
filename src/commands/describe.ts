import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { loadConfig } from "../core/config.ts";
import { getFilesDir, isImageMime } from "../core/files.ts";
import { describeAndEmbedFile } from "../core/file-processing.ts";

export default defineCommand({
  meta: {
    name: "describe",
    description: "Generate AI descriptions for image files",
  },
  args: {
    "file-slug": {
      type: "positional",
      description: "File slug to describe (omit with --all)",
      required: false,
    },
    all: {
      type: "boolean",
      description: "Describe all undescribed images",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Re-describe already-described files",
      default: false,
    },
    "max-files": {
      type: "string",
      description: "Maximum number of files to describe (used with --all)",
    },
    concurrency: {
      type: "string",
      description: "Parallel describe requests (default: 5)",
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
        ? engine.listFiles().filter(f => isImageMime(f.mime_type))
        : engine.listUndescribedFiles().filter(f => isImageMime(f.mime_type));

      if (args["max-files"]) {
        const maxFiles = parseInt(args["max-files"], 10);
        candidates = candidates.slice(0, maxFiles);
      }

      if (candidates.length === 0) {
        console.log("No image candidates to describe.");
        return;
      }

      const skipped = engine.listFiles().filter(f => isImageMime(f.mime_type)).length - candidates.length;
      console.log(`${candidates.length} image candidate(s)${skipped > 0 ? `, ${skipped} skipped` : ""}`);

      // Confirm in TTY if not --yes
      if (process.stdout.isTTY && !args.yes) {
        process.stdout.write(`Describe ${candidates.length} image(s)? [y/N] `);
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
          const result = await describeAndEmbedFile(
            engine,
            f.slug,
            filesDir,
            cfg.vision!,
            cfg.embed.model,
          );
          if (result.described) {
            completed++;
          } else {
            failed++;
          }

          // Progress line
          const done = completed + failed;
          if (process.stdout.isTTY) {
            process.stdout.write(`\rDescribing ${done}/${total}...  `);
          } else if (done % 10 === 0) {
            console.log(`Describing ${done}/${total}...`);
          }
        }));
      }

      process.off("SIGINT", handleSigint);
      if (process.stdout.isTTY) process.stdout.write("\n");

      if (interrupted) {
        console.log(`Interrupted after ${completed + failed}/${total}. Resume with: gbrain describe --all`);
      } else {
        console.log(`✓ Described ${completed} file(s), ${failed} failed, ${total - completed - failed} skipped`);
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

    if (!isImageMime(file.mime_type)) {
      console.error(`✗ ${fileSlug} is not an image file (${file.mime_type}). describe only supports image/* in v0.5.`);
      process.exit(1);
    }

    if (file.description && !args.force) {
      console.log(`· Already described. Use --force to override.`);
      return;
    }

    console.log(`Describing ${fileSlug}...`);
    const result = await describeAndEmbedFile(
      engine,
      fileSlug,
      filesDir,
      cfg.vision!,
      cfg.embed.model,
    );

    if (result.warning) {
      console.error(`✗ Description failed: ${result.warning}`);
      process.exit(1);
    }

    const desc = engine.getFile(fileSlug)?.description ?? "";
    console.log(`✓ Described ${fileSlug}: "${desc.slice(0, 60)}${desc.length > 60 ? "..." : ""}"`);
    const firstWords = desc.split(/\s+/).slice(0, 3).join(" ");
    console.log(`  Next: gbrain search "${firstWords}"`);
  },
});
