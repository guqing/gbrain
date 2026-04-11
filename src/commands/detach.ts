import { defineCommand } from "citty";
import { rmSync } from "fs";
import { join } from "path";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { getFilesDir } from "../core/files.ts";

export default defineCommand({
  meta: {
    name: "detach",
    description: "Detach a file from a page",
  },
  args: {
    "page-slug": {
      type: "positional",
      description: "Page slug",
      required: true,
    },
    "file-slug": {
      type: "positional",
      description: "File slug to detach",
      required: true,
    },
    purge: {
      type: "boolean",
      description: "Delete the file from disk if no other pages reference it",
      default: false,
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
    db: { type: "string", description: "Path to brain.db" },
  },
  run({ args }) {
    const pageSlug = args["page-slug"];
    const fileSlug = args["file-slug"];
    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));

    const file = engine.getFile(fileSlug);
    if (!file) {
      console.error(`✗ File not found: ${fileSlug}`);
      process.exit(1);
    }

    const page = engine.getPage(pageSlug);
    if (!page) {
      console.error(`✗ Page not found: ${pageSlug}`);
      process.exit(1);
    }

    const removedPath = engine.detachFile(pageSlug, fileSlug, args.purge);

    let purged = false;
    if (removedPath) {
      const diskPath = join(getFilesDir(), removedPath);
      try {
        rmSync(diskPath, { force: true });
        purged = true;
      } catch (err) {
        console.warn(`⚠ Could not delete file from disk: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (args.json) {
      console.log(JSON.stringify({
        file_slug: fileSlug,
        page_slug: pageSlug,
        purged,
        file_path: removedPath ?? null,
      }, null, 2));
    } else {
      console.log(`✓ Detached ${fileSlug} from ${pageSlug}`);
      if (args.purge) {
        if (purged) {
          console.log("  File removed from disk.");
        } else {
          console.log("  File kept on disk (still referenced by other pages).");
        }
      } else {
        console.log("  File record kept (use --purge to also delete the file).");
      }
    }
  },
});
