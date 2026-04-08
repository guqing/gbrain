import { defineCommand } from "citty";
import { existsSync } from "fs";
import { resolve } from "path";
import { createDb, resolveDbPath } from "../core/db.ts";

export default defineCommand({
  meta: {
    name: "init",
    description: "Create a new brain.db",
  },
  args: {
    path: {
      type: "positional",
      description: "Directory or file path for brain.db (default: current directory)",
      required: false,
    },
    db: {
      type: "option",
      description: "Explicit path to brain.db",
    },
  },
  run({ args }) {
    let dbPath: string;

    if (args.db) {
      dbPath = resolve(args.db);
    } else if (args.path) {
      const p = resolve(args.path);
      dbPath = p.endsWith(".db") ? p : `${p}/brain.db`;
    } else {
      dbPath = resolveDbPath();
    }

    if (existsSync(dbPath)) {
      console.log(`⚠ brain.db already exists at ${dbPath}`);
      console.log("  Use --db to specify a different path.");
      return;
    }

    createDb(dbPath);
    console.log(`✓ brain.db created at ${dbPath}`);
    console.log("");
    console.log("Next steps:");
    console.log(`  gbrain put concepts/my-first-note  # add a page`);
    console.log(`  gbrain search "your query"          # search the brain`);
    console.log(`  gbrain setup-mcp                    # connect to Claude Code`);
    console.log("");
    console.log(`  Set GBRAIN_DB=${dbPath} to use this brain from any directory.`);
  },
});
