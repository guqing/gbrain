import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { startMcpServer } from "../mcp/server.ts";

export default defineCommand({
  meta: { name: "serve", description: "Start the MCP stdio server" },
  args: {
    db: { type: "string", description: "Path to brain.db" },
  },
  async run({ args }) {
    const dbPath = resolveDbPath(args.db);
    const db = openDb(dbPath);
    process.stderr.write(`GBrain MCP server running (stdio) — brain: ${dbPath}\n`);
    process.stderr.write(`Tools: brain_search, brain_get, brain_put, brain_list, brain_link, brain_stats, brain_lint_summary\n`);
    await startMcpServer(db, dbPath);
  },
});
