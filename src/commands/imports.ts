import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

function statusIcon(status: string): string {
  switch (status) {
    case "completed": return "✓";
    case "completed_with_errors": return "⚠";
    case "failed": return "✗";
    case "interrupted": return "↩";
    default: return "·";
  }
}

export default defineCommand({
  meta: {
    name: "imports",
    description: "List and inspect import run history",
  },
  args: {
    "run-id": {
      type: "positional",
      description: "Show details for a specific import run",
      required: false,
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
    db: { type: "string", description: "Path to brain.db" },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const runIdStr = args["run-id"];

    if (runIdStr) {
      const runId = parseInt(runIdStr, 10);
      if (isNaN(runId)) {
        console.error(`✗ Invalid run ID: ${runIdStr}`);
        process.exit(1);
      }
      const run = engine.getImportRun(runId);
      if (!run) {
        console.error(`✗ Run not found: ${runId}`);
        process.exit(1);
      }
      if (args.json) {
        console.log(JSON.stringify(run, null, 2));
      } else {
        const icon = statusIcon(run.status);
        console.log(`Run #${run.id} ${icon} ${run.status}`);
        console.log(`  Source: ${run.source_type} — ${run.source_ref}`);
        console.log(`  Items: ${run.completed_items}/${run.total_items} completed, ${run.failed_items} failed`);
        console.log(`  Started: ${run.started_at}`);
        if (run.finished_at) console.log(`  Finished: ${run.finished_at}`);
        if (run.summary) console.log(`  Summary: ${run.summary}`);
        if (run.status === "interrupted" || run.status === "completed_with_errors") {
          console.log(`  Resume: exo import-chatgpt ${run.source_ref} --resume ${run.id}`);
        }
      }
      return;
    }

    // List mode
    const runs = engine.listImportRuns(20);
    if (args.json) {
      console.log(JSON.stringify(runs, null, 2));
      return;
    }
    if (runs.length === 0) {
      console.log("No import runs yet.");
      return;
    }
    const header = `${"ID".padEnd(6)} ${"SOURCE".padEnd(10)} ${"STATUS".padEnd(26)} ${"DONE/TOTAL".padEnd(12)} ${"FAILED".padEnd(8)} STARTED`;
    console.log(header);
    console.log("─".repeat(header.length));
    for (const r of runs) {
      const icon = statusIcon(r.status);
      const statusCol = `${icon} ${r.status}`.padEnd(26);
      const progress = `${r.completed_items}/${r.total_items}`.padEnd(12);
      const failed = String(r.failed_items).padEnd(8);
      const started = r.started_at.slice(0, 16);
      console.log(`${String(r.id).padEnd(6)} ${r.source_type.padEnd(10)} ${statusCol} ${progress} ${failed} ${started}`);
    }
  },
});
