import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { generateInboxSlug, deconflictSlug } from "../core/utils.ts";

export default defineCommand({
  meta: { name: "capture", description: "Quickly capture a note to the inbox (no LLM, <100ms)" },
  args: {
    db:   { type: "string",  description: "Path to brain.db" },
    text: { type: "positional", description: "Note text to capture", required: true },
  },
  run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const text = args.text as string;

    const baseSlug = generateInboxSlug(text);
    const slug = deconflictSlug(baseSlug, (s) => engine.getPage(s) !== null);

    const title = text.length > 60 ? text.slice(0, 57) + "..." : text;

    engine.putPage(slug, {
      type: "inbox",
      title,
      compiled_truth: text,
    });

    console.log(`✓ Captured to inbox: ${slug}`);
    console.log(`  Run 'gbrain compile' when ready to process.`);
  },
});
