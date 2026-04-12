import { defineCommand } from "citty";
import { VERSION } from "../version.ts";

interface Semver { major: number; minor: number; patch: number }

function parseSemver(v: string): Semver | null {
  const m = v.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function isMinorOrMajorBump(current: string, latest: string): boolean {
  const cur = parseSemver(current);
  const lat = parseSemver(latest);
  if (!cur || !lat) return false;
  if (lat.major > cur.major) return true;
  if (lat.major === cur.major && lat.minor > cur.minor) return true;
  return false;
}

function compareVersions(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function detectInstallMethod(): 'bun' | 'npm' | 'binary' {
  // Check if running via bun
  if (process.versions?.bun) return 'bun';
  // Fallback to npm
  return 'npm';
}

function upgradeCommand(method: ReturnType<typeof detectInstallMethod>): string {
  switch (method) {
    case 'bun':  return 'bun install -g @guqings/exo@latest';
    case 'npm':  return 'npm install -g @guqings/exo@latest';
    default:     return 'npm install -g @guqings/exo@latest';
  }
}

export interface CheckUpdateResult {
  current: string;
  latest: string;
  update_available: boolean;
  is_minor_or_major: boolean;
  upgrade_command: string;
}

export async function runCheckUpdate(silent = false): Promise<CheckUpdateResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch('https://registry.npmjs.org/@guqings%2fexo/latest', {
      signal: controller.signal,
      headers: { 'User-Agent': `exo/${VERSION}` },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return null;

    const data = await res.json() as { version?: string };
    const latest = data.version;
    if (!latest) return null;

    const cur = parseSemver(VERSION);
    const lat = parseSemver(latest);
    if (!cur || !lat) return null;

    const update_available = compareVersions(lat, cur) > 0;
    const is_minor_or_major = isMinorOrMajorBump(VERSION, latest);

    return {
      current: VERSION,
      latest,
      update_available,
      is_minor_or_major,
      upgrade_command: upgradeCommand(detectInstallMethod()),
    };
  } catch {
    if (!silent) {
      // Still fail-silent — network issues shouldn't break the CLI
    }
    return null;
  }
}

export default defineCommand({
  meta: { name: "check-update", description: "Check for a newer version of exo on npm" },
  args: {
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    const result = await runCheckUpdate();

    if (!result) {
      if (args.json) {
        console.log(JSON.stringify({ error: 'Could not fetch version from npm registry' }));
      } else {
        console.log('⚠  Could not check for updates (offline or npm registry unavailable)');
      }
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (!result.update_available) {
      console.log(`✓ exo is up to date (v${result.current})`);
      return;
    }

    if (result.is_minor_or_major) {
      console.log(`\n  ┌─────────────────────────────────────────────┐`);
      console.log(`  │  exo update available: v${result.current} → v${result.latest}  │`);
      console.log(`  │                                             │`);
      console.log(`  │  Upgrade:                                   │`);
      console.log(`  │    ${result.upgrade_command.padEnd(41)} │`);
      console.log(`  └─────────────────────────────────────────────┘\n`);
    } else {
      // Patch bump — just print once, no box
      console.log(`  exo patch available: v${result.current} → v${result.latest}  (${result.upgrade_command})`);
    }
  },
});
