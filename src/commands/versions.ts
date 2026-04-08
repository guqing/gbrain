import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "versions", description: "Manage page versions (snapshot, list, revert)" },
  args: {
    slug: { type: "positional", description: "Page slug", required: true },
    db: { type: "option", description: "Path to brain.db" },
    snap: { type: "boolean", description: "Create a version snapshot", default: false },
    revert: { type: "option", description: "Revert to version ID" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);

    if (args.snap) {
      const version = engine.createVersion(args.slug);
      console.log(`✓ Snapshot created: version ${version.id} at ${version.snapshot_at}`);
      return;
    }

    if (args.revert) {
      const versionId = parseInt(args.revert, 10);
      engine.revertToVersion(args.slug, versionId);
      console.log(`✓ Reverted ${args.slug} to version ${versionId}`);
      return;
    }

    const versions = engine.getVersions(args.slug);
    if (args.json) {
      console.log(JSON.stringify(versions, null, 2));
      return;
    }

    if (versions.length === 0) {
      console.log("No versions found.");
      return;
    }

    for (const v of versions) {
      console.log(`Version ${v.id}  ${v.snapshot_at}`);
    }
  },
});
