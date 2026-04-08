import { defineCommand } from "citty";
export default defineCommand({
  meta: { name: "harvest", description: "Harvest data from external sources (Phase 3)" },
  args: { db: { type: "option", description: "Path to brain.db" } },
  run() { console.log("Harvest command coming in Phase 3."); },
});
