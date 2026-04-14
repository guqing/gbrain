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

/** Returns true if something is already accepting TCP connections on the port. */
async function isPortListening(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(400) });
    return true;
  } catch (err: any) {
    // ECONNREFUSED / network error → nothing there
    // Any HTTP-level response (even 4xx/5xx) still means the port is live
    if (err?.cause?.code === "ECONNREFUSED") return false;
    if (err?.name === "TimeoutError") return false;
    return true;
  }
}

/** Poll until the port is listening or the timeout (ms) expires. */
async function waitForPort(port: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return true;
    await Bun.sleep(300);
  }
  return false;
}

function tryOpen(url: string) {
  const command = openCommand(url);
  if (!command) return;
  try {
    Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  } catch {}
}

const args = parseArgs(Bun.argv.slice(2));
const apiUrl = `http://127.0.0.1:${args.apiPort}`;
const uiUrl = `http://127.0.0.1:${args.uiPort}`;

// ── If the UI port is already occupied, reuse the running session ─────────────
if (await isPortListening(args.uiPort)) {
  console.log(`exo ui dev — already running`);
  console.log(`  Web: ${uiUrl}  (reusing existing session)`);
  if (!args.noOpen) tryOpen(uiUrl);
  process.exit(0);
}

// ── Fresh start: spawn API + Vite ─────────────────────────────────────────────
const apiCmd = ["bun", "run", "src/cli.ts", "ui", "--port", String(args.apiPort), "--no-open"];
if (args.db) apiCmd.push("--db", args.db);

const api = Bun.spawn(apiCmd, {
  cwd: process.cwd(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
});

const ui = Bun.spawn(
  ["bun", "run", "--cwd", "ui", "dev", "--host", "127.0.0.1", "--port", String(args.uiPort)],
  {
    cwd: process.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, EXO_UI_API_ORIGIN: apiUrl },
  },
);

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

console.log(`exo ui dev — starting`);
console.log(`  API: ${apiUrl}  (exo ui server)`);
console.log(`  Web: ${uiUrl}  (Vite, proxying /api/* → API)`);

// Wait for Vite to be ready before opening the browser so the tab loads immediately.
if (!args.noOpen) {
  const ready = await waitForPort(args.uiPort);
  if (ready) {
    tryOpen(uiUrl);
  } else {
    console.warn(`⚠ Vite didn't respond within 15 s — open ${uiUrl} manually`);
  }
}

const [apiExit, uiExit] = await Promise.all([api.exited, ui.exited]);
process.exit(apiExit !== 0 ? apiExit : uiExit);
