import { defineCommand } from "citty";
export default defineCommand({
  meta: { name: "digest", description: "Generate digests from brain content (Phase 3)" },
  args: { db: { type: "option", description: "Path to brain.db" } },
  run() { console.log("Digest command coming in Phase 3."); },
});
