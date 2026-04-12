import { defineCommand } from "citty";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { resolveDbPath } from "../core/db.ts";

const MCP_TARGETS = [
  {
    name: "Claude Code",
    configPath: join(homedir(), ".claude", "mcp.json"),
  },
  {
    name: "Cursor",
    configPath: join(homedir(), ".cursor", "mcp.json"),
  },
];

export default defineCommand({
  meta: { name: "setup-mcp", description: "Auto-configure MCP server in Claude Code / Cursor" },
  args: {
    db:   { type: "string",  description: "Path to brain.db to use in MCP config" },
    all:  { type: "boolean", description: "Configure all supported clients", default: false },
  },
  run({ args }) {
    const dbPath = resolveDbPath(args.db);

    // When installed via `bun install -g`, process.execPath is the Bun runtime,
    // not the exo shim. Detect script mode and find the real executable.
    const isScriptMode = (process.argv[1] ?? "").endsWith(".ts");
    const exoShim: string = isScriptMode ? (Bun.which("exo") ?? process.argv[1] ?? "exo") : process.execPath;

    const entry = exoShim.endsWith(".ts")
      ? { command: process.execPath, args: [exoShim, "serve", "--db", dbPath] }
      : { command: exoShim, args: ["serve", "--db", dbPath] };

    const targets = args.all ? MCP_TARGETS : MCP_TARGETS.slice(0, 1); // default: Claude Code only

    for (const target of targets) {
      const configPath = target.configPath;
      let config: { mcpServers?: Record<string, unknown> } = {};

      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch {
          console.error(`⚠ Could not parse ${configPath} — skipping ${target.name}`);
          continue;
        }
      }

      if (!config.mcpServers) config.mcpServers = {};

      if (config.mcpServers["exo"]) {
        console.log(`⚠ ${target.name}: exo already configured at ${configPath}`);
        console.log(`  Remove the existing entry to reconfigure.`);
        continue;
      }

      config.mcpServers["exo"] = entry;

      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log(`✓ ${target.name}: exo MCP server configured`);
      console.log(`  Config: ${configPath}`);
      console.log(`  Brain:  ${dbPath}`);
    }

    console.log("");
    console.log("Restart Claude Code / Cursor to activate the MCP server.");
    console.log("Verify with: exo serve --db " + dbPath);
  },
});
