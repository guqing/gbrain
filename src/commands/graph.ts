import { defineCommand } from "citty";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export default defineCommand({
  meta: { name: "graph", description: "Traverse the knowledge graph from a slug" },
  args: {
    slug: { type: "positional", description: "Starting page slug", required: true },
    db: { type: "option", description: "Path to brain.db" },
    depth: { type: "option", description: "Traversal depth (default 3)" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const db = openDb(resolveDbPath(args.db));
    const engine = new SqliteEngine(db);
    const depth = args.depth ? parseInt(args.depth, 10) : 3;
    const nodes = engine.traverseGraph(args.slug, depth);

    if (args.json) {
      console.log(JSON.stringify(nodes, null, 2));
      return;
    }

    for (const node of nodes) {
      const indent = '  '.repeat(node.depth);
      console.log(`${indent}${node.slug}  [${node.type}]`);
      for (const link of node.links) {
        console.log(`${indent}  → ${link.to_slug}${link.link_type ? ` (${link.link_type})` : ''}`);
      }
    }
  },
});
