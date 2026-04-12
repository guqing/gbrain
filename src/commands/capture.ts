import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { generateInboxSlug, deconflictSlug } from "../core/utils.ts";

export default defineCommand({
  meta: { name: "capture", description: "Quickly capture a note to the inbox (no LLM, <100ms)" },
  args: {
    db:    { type: "string",  description: "Path to brain.db" },
    title: { type: "string",  description: "Title override (used with stdin input)" },
    text:  { type: "positional", description: "Note text to capture (omit to read from stdin)", required: false },
  },
  async run({ args }) {
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));

    let text: string;
    // Read from stdin if no positional text and stdin is not a TTY (i.e. piped input)
    if (!args.text && !process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      text = Buffer.concat(chunks).toString("utf-8").trim();
      if (!text) {
        console.error("✗ stdin was empty. Provide text as an argument or pipe content.");
        process.exit(1);
      }
    } else if (args.text) {
      text = args.text as string;
    } else {
      console.error("✗ No input. Provide text as an argument or pipe content via stdin.");
      console.error("  Examples:");
      console.error("    exo capture \"quick note\"");
      console.error("    cat file.md | exo capture --title \"My Document\"");
      process.exit(1);
    }

    const baseSlug = generateInboxSlug(text);
    const slug = deconflictSlug(baseSlug, (s) => engine.getPage(s) !== null);

    // Use explicit --title, or first line of content, or truncated text
    const firstLine = text.split("\n")[0].replace(/^#+\s*/, "").trim();
    const derivedTitle = (args.title as string | undefined) ?? (firstLine.length > 0 ? firstLine : text);
    const title = derivedTitle.length > 80 ? derivedTitle.slice(0, 77) + "..." : derivedTitle;

    engine.putPage(slug, {
      type: "inbox",
      title,
      compiled_truth: text,
    });

    console.log(`✓ Captured to inbox: ${slug}`);
    console.log(`  Title: ${title}`);
    console.log(`  Run 'exo compile' when ready to process.`);
  },
});
