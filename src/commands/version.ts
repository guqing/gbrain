import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "version", description: "Show version" },
  args: {},
  run() {
    console.log("exo 0.1.0");
  },
});
