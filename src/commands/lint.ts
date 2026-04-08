import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import type { LintResult, StaleItem, LowConfidenceItem, SuggestedItem } from "../types.ts";
import type { PageRow } from "../types.ts";

export default defineCommand({
  meta: { name: "lint", description: "Check for stale, orphaned, and low-confidence pages" },
  args: {
    db:   { type: "option",  description: "Path to brain.db" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const today = new Date().toISOString().slice(0, 10)!;

    // 1. Stale: valid_until < today
    const allPages = db.query<PageRow, []>("SELECT * FROM pages").all();
    const stale: StaleItem[] = [];
    const lowConfidence: LowConfidenceItem[] = [];

    for (const row of allPages) {
      let fm: { valid_until?: string; confidence?: number } = {};
      try { fm = JSON.parse(row.frontmatter); } catch { /* ignore */ }

      if (fm.valid_until && fm.valid_until < today) {
        stale.push({ slug: row.slug, title: row.title, valid_until: fm.valid_until, confidence: fm.confidence });
      }
      if (fm.confidence !== undefined && fm.confidence < 5) {
        lowConfidence.push({ slug: row.slug, title: row.title, confidence: fm.confidence });
      }
    }

    // 2. Orphans: no incoming links
    const linkedSlugs = new Set(
      db.query<{ slug: string }, []>(
        `SELECT DISTINCT p.slug FROM pages p
         JOIN links l ON l.to_page_id = p.id`
      ).all().map(r => r.slug)
    );
    const orphans = allPages
      .map(r => r.slug)
      .filter(s => !linkedSlugs.has(s));

    // 3. Suggested: slugs mentioned in [[wiki-links]] but missing as pages
    const existingSlugs = new Set(allPages.map(r => r.slug));
    const mentionCounts = new Map<string, number>();
    for (const row of allPages) {
      const content = row.compiled_truth + " " + row.timeline;
      for (const match of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const slug = (match[1] ?? "").trim();
        if (!existingSlugs.has(slug)) {
          mentionCounts.set(slug, (mentionCounts.get(slug) ?? 0) + 1);
        }
      }
    }
    const suggested: SuggestedItem[] = [...mentionCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([slug, mentionCount]) => ({ slug, mentionCount }));

    const result: LintResult = { stale, lowConfidence, orphans, suggested };

    if (args.json) { console.log(JSON.stringify(result, null, 2)); return; }

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
    if (total === 0 && orphans.length === 0 && suggested.length === 0) {
      console.log("✓ Brain looks healthy.");
    } else {
      console.log(`\nSummary: ${stale.length} stale, ${lowConfidence.length} low-confidence, ${orphans.length} orphans, ${suggested.length} suggested.`);
    }
  },
});
