import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getConfigPath, loadConfig, listConfig, setConfigKey } from "../core/config.ts";

let originalConfig: string | null = null;
let hadConfig = false;

describe("config ui settings", () => {
  beforeEach(() => {
    const configPath = getConfigPath();
    hadConfig = existsSync(configPath);
    originalConfig = hadConfig ? readFileSync(configPath, "utf-8") : null;
    mkdirSync(dirname(configPath), { recursive: true });
    rmSync(configPath, { force: true });
    delete process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_BASE_URL"];
    delete process.env["EXO_DB"];
  });

  afterEach(() => {
    const configPath = getConfigPath();
    if (hadConfig && originalConfig !== null) {
      writeFileSync(configPath, originalConfig, "utf-8");
    } else {
      rmSync(configPath, { force: true });
    }
  });

  test("defaults ui.port to 7499", () => {
    expect(loadConfig().ui.port).toBe(7499);
  });

  test("persists ui.port through config set and list", () => {
    setConfigKey("ui.port", "8123");

    expect(loadConfig().ui.port).toBe(8123);
    expect(listConfig().find((entry) => entry.key === "ui.port")?.value).toBe("8123");
  });

  test("rejects invalid ui.port values", () => {
    expect(() => setConfigKey("ui.port", "0")).toThrow();
  });
});
