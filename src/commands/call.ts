import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { dispatchTool } from "../core/dispatch.ts";
import { loadConfig } from "../core/config.ts";

export default defineCommand({
  meta: {
    name: "call",
    description: "Invoke any MCP tool directly from the CLI (useful for debugging agent integrations)",
  },
  args: {
    tool: {
      type: "positional",
      description: "Tool name (e.g. brain_get, brain_search, brain_hybrid_search)",
      required: true,
    },
    params: {
      type: "positional",
      description: 'JSON params object (e.g. \'{"slug":"knowledge/sqlite"}\')',
      required: false,
    },
    db: { type: "string", description: "Path to brain.db" },
  },
  async run({ args }) {
    const cfg = loadConfig(args.db ? { db: args.db } : undefined);
    const dbPath = resolveDbPath(args.db);
    const db = openDb(dbPath);
    const engine = new SqliteEngine(db);

    // Parse params — accept positional arg, piped stdin, or empty object
    let input: Record<string, unknown> = {};
    const rawParams = args.params as string | undefined;

    if (rawParams) {
      try {
        input = JSON.parse(rawParams);
      } catch {
        console.error(`✗ Invalid JSON params: ${rawParams}`);
        console.error("  Example: exo call brain_get '{\"slug\":\"knowledge/sqlite\"}'");
        process.exit(1);
      }
    } else if (!process.stdin.isTTY) {
      // Read from stdin pipe: echo '{"slug":"test"}' | exo call brain_get
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString().trim();
      if (raw) {
        try {
          input = JSON.parse(raw);
        } catch {
          console.error(`✗ Invalid JSON from stdin: ${raw}`);
          process.exit(1);
        }
      }
    }

    // Inject dbPath into compile_inbox config so it knows where to find the DB
    (cfg as unknown as Record<string, unknown>)["_dbPath"] = dbPath;

    const result = await dispatchTool(engine, dbPath, args.tool as string, input);

    const text = result.content[0]?.text ?? "";
    console.log(text);

    if (result.isError) process.exit(1);
  },
});
