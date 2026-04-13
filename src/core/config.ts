import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import TOML from "@ltd/j-toml";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExoConfig {
  db: {
    path?: string;
  };
  ui: {
    port: number;
  };
  embed: {
    base_url?: string;
    api_key?: string;
    model: string;
    dimensions: number;
  };
  compile: {
    base_url?: string;
    api_key?: string;
    model?: string;
  };
  vision: {
    base_url?: string;
    api_key?: string;
    model: string;
  };
  /** Whisper-compatible transcription endpoint. Falls back to vision config if omitted. */
  transcription?: {
    base_url?: string;
    api_key?: string;
  };
}

// Allowed keys for `exo config set`
export const CONFIG_KEYS = [
  "db.path",
  "ui.port",
  "embed.base_url",
  "embed.api_key",
  "embed.model",
  "embed.dimensions",
  "compile.base_url",
  "compile.api_key",
  "compile.model",
  "vision.base_url",
  "vision.api_key",
  "vision.model",
  "transcription.base_url",
  "transcription.api_key",
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

// ── Paths ─────────────────────────────────────────────────────────────────────

export function getConfigDir(): string {
  return join(homedir(), ".exo");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.toml");
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: ExoConfig = {
  db: {
    path: join(homedir(), ".exo", "brain.db"),
  },
  ui: {
    port: 7499,
  },
  embed: {
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
  compile: {
    model: "gpt-4.1-mini",
  },
  vision: {
    model: "openai/gpt-4o",
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
  ui?: { port?: number };
  embed?: { base_url?: string; api_key?: string; model?: string; dimensions?: number };
  compile?: { base_url?: string; api_key?: string; model?: string };
  vision?: { base_url?: string; api_key?: string; model?: string };
  transcription?: { base_url?: string; api_key?: string };
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

    const ui = parsed["ui"] as Record<string, unknown> | undefined;
    if (ui) {
      result.ui = {};
      if (typeof ui["port"] === "number") {
        result.ui.port = ui["port"] as number;
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

    const compile = parsed["compile"] as Record<string, unknown> | undefined;
    if (compile) {
      result.compile = {};
      if (typeof compile["base_url"] === "string") result.compile.base_url = compile["base_url"];
      if (typeof compile["api_key"] === "string")  result.compile.api_key  = compile["api_key"];
      if (typeof compile["model"] === "string")    result.compile.model    = compile["model"];
    }

    const vision = parsed["vision"] as Record<string, unknown> | undefined;
    if (vision) {
      result.vision = {};
      if (typeof vision["base_url"] === "string") result.vision.base_url = vision["base_url"];
      if (typeof vision["api_key"] === "string")  result.vision.api_key  = vision["api_key"];
      if (typeof vision["model"] === "string")    result.vision.model    = vision["model"];
    }

    const transcription = parsed["transcription"] as Record<string, unknown> | undefined;
    if (transcription) {
      result.transcription = {};
      if (typeof transcription["base_url"] === "string") result.transcription.base_url = transcription["base_url"];
      if (typeof transcription["api_key"] === "string")  result.transcription.api_key  = transcription["api_key"];
    }

    return result;
  } catch (e) {
    console.warn(`⚠ Failed to parse ~/.exo/config.toml: ${e instanceof Error ? e.message : e}`);
    console.warn("  Falling back to defaults.");
    return {};
  }
}

// ── Load (merge: env > config file > defaults) ────────────────────────────────

export function loadConfig(overrides?: { db?: string }): ExoConfig {
  const file = readTomlFile();

  const cfg: ExoConfig = {
    db: {
      path: overrides?.db
        ?? process.env["EXO_DB"]
        ?? file.db?.path
        ?? DEFAULTS.db.path,
    },
    ui: {
      port: file.ui?.port ?? DEFAULTS.ui.port,
    },
    embed: {
      base_url:   process.env["OPENAI_BASE_URL"]  ?? file.embed?.base_url  ?? DEFAULTS.embed.base_url,
      api_key:    process.env["OPENAI_API_KEY"]   ?? file.embed?.api_key   ?? DEFAULTS.embed.api_key,
      model:      file.embed?.model      ?? DEFAULTS.embed.model,
      dimensions: file.embed?.dimensions ?? DEFAULTS.embed.dimensions,
    },
    compile: {
      base_url: file.compile?.base_url ?? file.embed?.base_url ?? process.env["OPENAI_BASE_URL"],
      api_key:  file.compile?.api_key  ?? file.embed?.api_key  ?? process.env["OPENAI_API_KEY"],
      model:    file.compile?.model    ?? DEFAULTS.compile.model,
    },
    vision: {
      base_url: file.vision?.base_url ?? file.embed?.base_url ?? process.env["OPENAI_BASE_URL"],
      api_key:  file.vision?.api_key  ?? file.embed?.api_key  ?? process.env["OPENAI_API_KEY"],
      model:    file.vision?.model    ?? DEFAULTS.vision.model,
    },
    // Transcription defaults to vision config (same base_url + api_key) if not explicitly set.
    transcription: {
      base_url: file.transcription?.base_url ?? file.vision?.base_url ?? file.embed?.base_url ?? process.env["OPENAI_BASE_URL"],
      api_key:  file.transcription?.api_key  ?? file.vision?.api_key  ?? file.embed?.api_key  ?? process.env["OPENAI_API_KEY"],
    },
  };

  return cfg;
}

// ── Source tracking (for `exo config list`) ────────────────────────────────

type ConfigSource = "flag" | `env: ${string}` | "config" | "config (embed)" | "default";

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
    dbFlagVal ?? process.env["EXO_DB"] ?? file.db?.path ?? "";
  entries.push({
    key: "db.path",
    value: dbVal,
    source: source(dbFlagVal, "EXO_DB", file.db?.path),
  });

  const uiPortVal = String(file.ui?.port ?? DEFAULTS.ui.port);
  entries.push({
    key: "ui.port",
    value: uiPortVal,
    source: file.ui?.port !== undefined ? "config" : "default",
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

  // compile.base_url
  const cbuVal = file.compile?.base_url ?? file.embed?.base_url ?? process.env["OPENAI_BASE_URL"] ?? "";
  entries.push({
    key: "compile.base_url",
    value: cbuVal,
    source: file.compile?.base_url ? "config" : (file.embed?.base_url ? "config (embed)" : (process.env["OPENAI_BASE_URL"] ? "env: OPENAI_BASE_URL" : "default")),
  });

  // compile.api_key
  const cRawKey = file.compile?.api_key ?? file.embed?.api_key ?? process.env["OPENAI_API_KEY"] ?? "";
  const cRedacted = cRawKey.length > 4 ? cRawKey.slice(0, 4) + "****" : cRawKey ? "****" : "";
  entries.push({
    key: "compile.api_key",
    value: cRedacted,
    source: file.compile?.api_key ? "config" : (file.embed?.api_key ? "config (embed)" : (process.env["OPENAI_API_KEY"] ? "env: OPENAI_API_KEY" : "default")),
  });

  // compile.model
  const cModelVal = file.compile?.model ?? DEFAULTS.compile.model ?? "";
  entries.push({
    key: "compile.model",
    value: cModelVal,
    source: file.compile?.model ? "config" : "default",
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
  let raw: Record<string, Record<string, string | number>> = {
    db: {},
    ui: {},
    embed: {},
    compile: {},
    vision: {},
    transcription: {},
  };

  if (existsSync(cfgPath)) {
    try {
      const parsed = TOML.parse(readFileSync(cfgPath, "utf-8"), { bigint: false }) as Record<string, unknown>;
      if (parsed["db"]) raw["db"] = parsed["db"] as Record<string, string>;
      if (parsed["ui"]) raw["ui"] = parsed["ui"] as Record<string, string | number>;
      if (parsed["embed"]) raw["embed"] = parsed["embed"] as Record<string, string | number>;
      if (parsed["compile"]) raw["compile"] = parsed["compile"] as Record<string, string | number>;
      if (parsed["vision"]) raw["vision"] = parsed["vision"] as Record<string, string | number>;
      if (parsed["transcription"]) raw["transcription"] = parsed["transcription"] as Record<string, string | number>;
    } catch {
      // ignore parse errors — we'll overwrite
    }
  }

  const [section, field] = key.split(".") as [string, string];
  if (!raw[section]) raw[section] = {};

  if (key === "embed.dimensions" || key === "ui.port") {
    const n = parseInt(value, 10);
    if (isNaN(n) || n <= 0) throw new Error(`${key} must be a positive integer, got '${value}'`);
    raw[section]![field] = n;
  } else {
    raw[section]![field] = value;
  }

  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(cfgPath, serializeConfig(raw), "utf-8");
}
