import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import type { LintResult } from "../types.ts";

export default defineCommand({
  meta: { name: "lint", description: "Check for stale, orphaned, and low-confidence pages" },
  args: {
    db:   { type: "string",  description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const result: LintResult = engine.getLintReport();

    if (args.json) { console.log(JSON.stringify(result, null, 2)); return; }

    const { stale, lowConfidence, orphans, suggested, inbox_queue } = result;

    if (inbox_queue.count > 0) {
      const oldest = inbox_queue.oldest_date ? inbox_queue.oldest_date.slice(0, 10) : "?";
      console.log(`\nINBOX QUEUE (${inbox_queue.count} items waiting — oldest: ${oldest}):`);
      console.log(`  Run 'exo compile' to process.`);
    }

    if (stale.length) {
      console.log(`\nSTALE (${stale.length}):`);
      for (const p of stale) {
        const conf = p.confidence !== undefined ? `, confidence: ${p.confidence}` : "";
        console.log(`  ⚠ ${p.slug}  (expired ${p.valid_until}${conf})`);
      }
    }

    if (lowConfidence.length) {
      console.log(`\nLOW CONFIDENCE (${lowConfidence.length}):`);
      for (const p of lowConfidence) {
        console.log(`  ⚠ ${p.slug}  (confidence: ${p.confidence}/10)`);
      }
    }

    if (orphans.length) {
      console.log(`\nORPHANS (${orphans.length}) — no incoming links:`);
      for (const s of orphans.slice(0, 20)) {
        console.log(`  ${s}`);
      }
      if (orphans.length > 20) console.log(`  ... and ${orphans.length - 20} more`);
    }

    if (suggested.length) {
      console.log(`\nSUGGESTED PAGES (mentioned but missing):`);
      for (const s of suggested.slice(0, 10)) {
        console.log(`  ${s.slug}  (mentioned ${s.mentionCount}×)`);
      }
    }

    const total = stale.length + lowConfidence.length;
    if (total === 0 && orphans.length === 0 && suggested.length === 0 && inbox_queue.count === 0) {
      console.log("✓ Brain looks healthy.");
    } else {
      const inboxNote = inbox_queue.count > 0 ? `, ${inbox_queue.count} inbox` : "";
      console.log(`\nSummary: ${stale.length} stale, ${lowConfidence.length} low-confidence, ${orphans.length} orphans, ${suggested.length} suggested${inboxNote}.`);
    }
  },
});
