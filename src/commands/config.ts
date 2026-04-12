import { defineCommand } from "citty";
import {
  loadConfig,
  listConfig,
  setConfigKey,
  getConfigPath,
  CONFIG_KEYS,
  type ConfigKey,
} from "../core/config.ts";

export default defineCommand({
  meta: { name: "config", description: "View and set exo configuration" },
  args: {
    action: {
      type: "positional",
      description: "Action: get | set | list",
      required: false,
    },
    key: {
      type: "positional",
      description: "Config key (e.g. embed.base_url)",
      required: false,
    },
    value: {
      type: "positional",
      description: "Value to set",
      required: false,
    },
  },
  run({ args }) {
    const action = args.action as string | undefined;

    if (!action || action === "list") {
      // exo config [list]
      const entries = listConfig();
      const maxKey = Math.max(...entries.map(e => e.key.length));
      const maxVal = Math.max(...entries.map(e => e.value.length));
      console.log(`Config file: ${getConfigPath()}\n`);
      for (const entry of entries) {
        const k = entry.key.padEnd(maxKey);
        const v = (entry.value || "(not set)").padEnd(maxVal);
        console.log(`  ${k}  =  ${v}  [${entry.source}]`);
      }
      return;
    }

    if (action === "get") {
      if (!args.key) {
        console.error("✗ Usage: exo config get <key>");
        console.error(`  Keys: ${CONFIG_KEYS.join(", ")}`);
        process.exit(1);
      }
      const entries = listConfig();
      const entry = entries.find(e => e.key === args.key);
      if (!entry) {
        console.error(`✗ Unknown config key: ${args.key}`);
        console.error(`  Keys: ${CONFIG_KEYS.join(", ")}`);
        process.exit(1);
      }
      console.log(entry.value || "(not set)");
      return;
    }

    if (action === "set") {
      if (!args.key || args.value === undefined) {
        console.error("✗ Usage: exo config set <key> <value>");
        console.error(`  Keys: ${CONFIG_KEYS.join(", ")}`);
        process.exit(1);
      }
      if (!(CONFIG_KEYS as readonly string[]).includes(args.key)) {
        console.error(`✗ Unknown config key: ${args.key}`);
        console.error(`  Allowed: ${CONFIG_KEYS.join(", ")}`);
        process.exit(1);
      }
      try {
        setConfigKey(args.key as ConfigKey, args.value as string);
        console.log(`✓ Set ${args.key} = ${args.key.includes("api_key") ? args.value.slice(0, 4) + "****" : args.value}`);
        console.log(`  Config file: ${getConfigPath()}`);
      } catch (e) {
        console.error(`✗ ${e instanceof Error ? e.message : e}`);
        process.exit(1);
      }
      return;
    }

    console.error(`✗ Unknown action: ${action}`);
    console.error("  Usage: exo config [list | get <key> | set <key> <value>]");
    process.exit(1);
  },
});
