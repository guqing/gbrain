#!/usr/bin/env bun

function parseArgs(argv: string[]) {
  const result: {
    db?: string;
    apiPort: number;
    uiPort: number;
    noOpen: boolean;
  } = {
    apiPort: 7499,
    uiPort: 3002,
    noOpen: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db") result.db = argv[++i];
    else if (arg === "--api-port") result.apiPort = Number.parseInt(argv[++i] ?? "", 10);
    else if (arg === "--ui-port") result.uiPort = Number.parseInt(argv[++i] ?? "", 10);
    else if (arg === "--no-open") result.noOpen = true;
  }

  if (!Number.isInteger(result.apiPort) || result.apiPort < 1 || result.apiPort > 65535) {
    throw new Error(`Invalid --api-port: ${result.apiPort}`);
  }
  if (!Number.isInteger(result.uiPort) || result.uiPort < 1 || result.uiPort > 65535) {
    throw new Error(`Invalid --ui-port: ${result.uiPort}`);
  }

  return result;
}

function openCommand(url: string): string[] | null {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  if (process.platform === "linux") return ["xdg-open", url];
  return null;
}

const args = parseArgs(Bun.argv.slice(2));
const apiUrl = `http://127.0.0.1:${args.apiPort}`;
const uiUrl = `http://127.0.0.1:${args.uiPort}`;

const apiCmd = ["bun", "run", "src/cli.ts", "ui", "--port", String(args.apiPort), "--no-open"];
if (args.db) apiCmd.push("--db", args.db);

const api = Bun.spawn(apiCmd, {
  cwd: process.cwd(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
});

const ui = Bun.spawn(["bun", "run", "--cwd", "ui", "dev", "--host", "127.0.0.1", "--port", String(args.uiPort)], {
  cwd: process.cwd(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    EXO_UI_API_ORIGIN: apiUrl,
  },
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  api.kill();
  ui.kill();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`exo ui dev`);
console.log(`  API: ${apiUrl}`);
console.log(`  Web: ${uiUrl}`);
console.log(`  Proxying /api/* from Vite to the Bun UI server.`);

if (!args.noOpen) {
  const command = openCommand(uiUrl);
  if (command) {
    try {
      Bun.spawn(command, {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {}
  }
}

const [apiExit, uiExit] = await Promise.all([api.exited, ui.exited]);
process.exit(apiExit !== 0 ? apiExit : uiExit);
