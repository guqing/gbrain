import { defineCommand } from "citty";
import { existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { createDb, resolveDbPath } from "../core/db.ts";
import { getConfigDir, getConfigPath } from "../core/config.ts";

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
      type: "string",
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

    // Ensure parent directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    createDb(dbPath);
    console.log(`✓ brain.db created at ${dbPath}`);

    // Ensure config directory exists
    mkdirSync(getConfigDir(), { recursive: true });

    console.log("");
    console.log("Next steps:");
    console.log(`  gbrain put concepts/my-first-note  # add a page`);
    console.log(`  gbrain search "your query"          # search the brain`);
    console.log(`  gbrain setup-mcp                    # connect to Claude Code`);
    console.log("");
    console.log(`  Configure embeddings: gbrain config set embed.base_url <url>`);
    console.log(`  Config file: ${getConfigPath()}`);
  },
});
