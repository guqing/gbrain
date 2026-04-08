import { defineCommand } from "citty";
export default defineCommand({
  meta: { name: "query", description: "Coming in Phase 2" },
  args: { db: { type: "option", description: "Path to brain.db" } },
  run() { console.log("This command is coming in Phase 2. See DESIGN.md."); },
});
