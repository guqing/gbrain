import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import TOML from "@ltd/j-toml";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GbrainConfig {
  db: {
    path?: string;
  };
  embed: {
    base_url?: string;
    api_key?: string;
    model: string;
    dimensions: number;
  };
}

// Allowed keys for `gbrain config set`
export const CONFIG_KEYS = [
  "db.path",
  "embed.base_url",
  "embed.api_key",
  "embed.model",
  "embed.dimensions",
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

// ── Paths ─────────────────────────────────────────────────────────────────────

export function getConfigDir(): string {
  return join(homedir(), ".gbrain");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.toml");
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: GbrainConfig = {
  db: {
    path: join(homedir(), ".gbrain", "brain.db"),
  },
  embed: {
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
};

// ── Tilde expansion ───────────────────────────────────────────────────────────

function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return p.replace("~", homedir());
  }
  return p;
}

// ── Internal partial type for file parsing ────────────────────────────────────

interface PartialConfig {
  db?: { path?: string };
  embed?: { base_url?: string; api_key?: string; model?: string; dimensions?: number };
}

// ── Read ──────────────────────────────────────────────────────────────────────

function readTomlFile(): PartialConfig {
  const cfgPath = getConfigPath();
  if (!existsSync(cfgPath)) return {};

  try {
    const raw = readFileSync(cfgPath, "utf-8");
    const parsed = TOML.parse(raw, { bigint: false }) as Record<string, unknown>;

    const result: PartialConfig = {};

    const db = parsed["db"] as Record<string, unknown> | undefined;
    if (db) {
      result.db = {};
      if (typeof db["path"] === "string") {
        result.db.path = expandTilde(db["path"]);
      }
    }

    const embed = parsed["embed"] as Record<string, unknown> | undefined;
    if (embed) {
      result.embed = {};
      if (typeof embed["base_url"] === "string")   result.embed.base_url   = embed["base_url"];
      if (typeof embed["api_key"] === "string")     result.embed.api_key    = embed["api_key"];
      if (typeof embed["model"] === "string")       result.embed.model      = embed["model"];
      if (typeof embed["dimensions"] === "number")  result.embed.dimensions = embed["dimensions"] as number;
    }

    return result;
  } catch (e) {
    console.warn(`⚠ Failed to parse ~/.gbrain/config.toml: ${e instanceof Error ? e.message : e}`);
    console.warn("  Falling back to defaults.");
    return {};
  }
}

// ── Load (merge: env > config file > defaults) ────────────────────────────────

export function loadConfig(overrides?: { db?: string }): GbrainConfig {
  const file = readTomlFile();

  const cfg: GbrainConfig = {
    db: {
      path: overrides?.db
        ?? process.env["GBRAIN_DB"]
        ?? file.db?.path
        ?? DEFAULTS.db.path,
    },
    embed: {
      base_url:   process.env["OPENAI_BASE_URL"]  ?? file.embed?.base_url  ?? DEFAULTS.embed.base_url,
      api_key:    process.env["OPENAI_API_KEY"]   ?? file.embed?.api_key   ?? DEFAULTS.embed.api_key,
      model:      file.embed?.model      ?? DEFAULTS.embed.model,
      dimensions: file.embed?.dimensions ?? DEFAULTS.embed.dimensions,
    },
  };

  return cfg;
}

// ── Source tracking (for `gbrain config list`) ────────────────────────────────

type ConfigSource = "flag" | `env: ${string}` | "config" | "default";

export interface ConfigEntry {
  key: string;
  value: string;
  source: ConfigSource;
}

export function listConfig(overrides?: { db?: string }): ConfigEntry[] {
  const file = readTomlFile();
  const entries: ConfigEntry[] = [];

  function source(
    flag: string | undefined,
    envVar: string,
    fileVal: string | number | undefined,
  ): ConfigSource {
    if (flag !== undefined) return "flag";
    if (process.env[envVar] !== undefined) return `env: ${envVar}`;
    if (fileVal !== undefined) return "config";
    return "default";
  }

  // db.path
  const dbFlagVal = overrides?.db;
  const dbVal =
    dbFlagVal ?? process.env["GBRAIN_DB"] ?? file.db?.path ?? "";
  entries.push({
    key: "db.path",
    value: dbVal,
    source: source(dbFlagVal, "GBRAIN_DB", file.db?.path),
  });

  // embed.base_url
  const buVal = process.env["OPENAI_BASE_URL"] ?? file.embed?.base_url ?? "";
  entries.push({
    key: "embed.base_url",
    value: buVal,
    source: source(undefined, "OPENAI_BASE_URL", file.embed?.base_url),
  });

  // embed.api_key
  const rawKey = process.env["OPENAI_API_KEY"] ?? file.embed?.api_key ?? "";
  const redacted = rawKey.length > 4 ? rawKey.slice(0, 4) + "****" : rawKey ? "****" : "";
  entries.push({
    key: "embed.api_key",
    value: redacted,
    source: source(undefined, "OPENAI_API_KEY", file.embed?.api_key),
  });

  // embed.model
  const modelVal = file.embed?.model ?? DEFAULTS.embed.model;
  entries.push({
    key: "embed.model",
    value: modelVal,
    source: file.embed?.model ? "config" : "default",
  });

  // embed.dimensions
  const dimVal = String(file.embed?.dimensions ?? DEFAULTS.embed.dimensions);
  entries.push({
    key: "embed.dimensions",
    value: dimVal,
    source: file.embed?.dimensions !== undefined ? "config" : "default",
  });

  return entries;
}

// ── Write ─────────────────────────────────────────────────────────────────────

function serializeConfig(cfg: Record<string, Record<string, string | number | undefined>>): string {
  const lines: string[] = [];
  for (const [section, values] of Object.entries(cfg)) {
    const nonEmpty = Object.entries(values).filter(([, v]) => v !== undefined && v !== "");
    if (nonEmpty.length === 0) continue;
    lines.push(`[${section}]`);
    for (const [k, v] of nonEmpty) {
      if (typeof v === "number") {
        lines.push(`${k} = ${v}`);
      } else {
        lines.push(`${k} = ${JSON.stringify(v)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function setConfigKey(key: ConfigKey, value: string): void {
  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Unknown config key '${key}'. Allowed: ${CONFIG_KEYS.join(", ")}`);
  }

  // Read current raw file (if exists) into a plain object
  const cfgPath = getConfigPath();
  let raw: Record<string, Record<string, string | number>> = { db: {}, embed: {} };

  if (existsSync(cfgPath)) {
    try {
      const parsed = TOML.parse(readFileSync(cfgPath, "utf-8"), { bigint: false }) as Record<string, unknown>;
      if (parsed["db"]) raw["db"] = parsed["db"] as Record<string, string>;
      if (parsed["embed"]) raw["embed"] = parsed["embed"] as Record<string, string | number>;
    } catch {
      // ignore parse errors — we'll overwrite
    }
  }

  const [section, field] = key.split(".") as [string, string];
  if (!raw[section]) raw[section] = {};

  if (key === "embed.dimensions") {
    const n = parseInt(value, 10);
    if (isNaN(n) || n <= 0) throw new Error(`embed.dimensions must be a positive integer, got '${value}'`);
    raw[section]![field] = n;
  } else {
    raw[section]![field] = value;
  }

  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(cfgPath, serializeConfig(raw), "utf-8");
}
