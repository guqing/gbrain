import { defineCommand } from "citty";
import { existsSync, statSync } from "fs";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { loadConfig } from "../core/config.ts";
import { ChatGPTAdapter, findConversationFiles } from "../core/importers/chatgpt.ts";
import { ImportRunner } from "../core/importers/runner.ts";

export default defineCommand({
  meta: {
    name: "import-chatgpt",
    description: "Import a ChatGPT export directory into your brain",
  },
  args: {
    "export-dir": {
      type: "positional",
      description: "Path to unpacked ChatGPT export directory",
      required: true,
    },
    "dry-run": {
      type: "boolean",
      description: "Preview what would be imported without writing to DB",
      default: false,
    },
    describe: {
      type: "boolean",
      description: "Generate AI descriptions for imported images",
      default: false,
    },
    resume: {
      type: "string",
      description: "Resume a previous run by ID (or 'latest')",
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
    db: { type: "string", description: "Path to brain.db" },
  },
  async run({ args }) {
    const exportDir = args["export-dir"];
    const cfg = loadConfig();

    // Validate export dir
    if (!existsSync(exportDir)) {
      console.error(`✗ Directory not found: ${exportDir}`);
      process.exit(1);
    }

    // Reject zip files
    if (exportDir.endsWith(".zip") || (statSync(exportDir).isFile() && exportDir.includes("zip"))) {
      console.error(`✗ ${exportDir} appears to be a zip file. Unpack it first: unzip ${exportDir} -d <dir>`);
      process.exit(1);
    }

    if (!statSync(exportDir).isDirectory()) {
      console.error(`✗ ${exportDir} is not a directory`);
      process.exit(1);
    }

    // Validate conversations exist
    const convFiles = findConversationFiles(exportDir);
    if (convFiles.length === 0) {
      console.error(`✗ No conversations found. Expected a ChatGPT export directory with conversations-*.json`);
      process.exit(1);
    }

    // Validate vision config if --describe
    if (args.describe && !cfg.vision?.api_key) {
      console.error("✗ Vision API not configured. Set with: gbrain config set vision.api_key <key>");
      process.exit(1);
    }

    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const adapter = new ChatGPTAdapter();
    const runner = new ImportRunner(engine, adapter);

    // Resolve --resume
    let resumeRunId: number | undefined;
    if (args.resume) {
      if (args.resume === "latest") {
        const runs = engine.listImportRuns(1);
        const latest = runs.find(r => r.source_ref === exportDir);
        if (!latest) {
          console.log("No previous import run found for this directory. Starting fresh.");
        } else if (latest.status === "completed") {
          console.warn(`⚠ Run ${latest.id} is already completed. Starting new run.`);
        } else {
          resumeRunId = latest.id;
          console.log(`Resuming run ${resumeRunId} (status: ${latest.status})`);
        }
      } else {
        resumeRunId = parseInt(args.resume, 10);
        if (isNaN(resumeRunId)) {
          console.error(`✗ Invalid resume ID: ${args.resume}`);
          process.exit(1);
        }
      }
    }

    console.log(args["dry-run"] ? "Dry run — no changes will be written." : `Importing from: ${exportDir}`);

    const result = await runner.run(
      exportDir,
      {
        describe: args.describe,
        dryRun: args["dry-run"],
        visionCfg: cfg.vision,
        embedModel: cfg.embed.model,
        onProgress: (completed, failed, total, lastSlug) => {
          if (process.stdout.isTTY) {
            process.stdout.write(`\r  ${completed + failed}/${total} — last: ${lastSlug}  `);
          } else if ((completed + failed) % 10 === 0) {
            console.log(`  ${completed + failed}/${total} processed`);
          }
        },
      },
      resumeRunId,
    );

    if (process.stdout.isTTY) process.stdout.write("\n");

    if (args.json) {
      console.log(JSON.stringify({
        summary: `Imported ${result.completed} conversations, ${result.imagesAttached} images attached`,
        next_action: result.imagesAttached > 0 && !args.describe
          ? "gbrain describe --all"
          : null,
        details: result,
      }, null, 2));
    } else {
      const status = result.status === "completed" ? "✓" : "⚠";
      console.log(`${status} ${result.status}`);
      console.log(`  Conversations: ${result.completed} imported, ${result.failed} failed, ${result.skipped} skipped`);
      console.log(`  Images: ${result.imagesAttached} attached, ${result.imagesUnmatched} unmatched`);
      if (result.runId > 0) {
        console.log(`  Run ID: ${result.runId} (gbrain imports ${result.runId} for details)`);
      }
      if (result.imagesAttached > 0 && !args.describe) {
        console.log(`  Next: gbrain describe --all`);
      }
    }
  },
});
