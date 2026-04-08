import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "gbrain",
    version: "0.1.0",
    description: "Personal knowledge brain — CLI + MCP server",
  },
  subCommands: {
    init: () => import("./commands/init.ts").then((m) => m.default),
    get: () => import("./commands/get.ts").then((m) => m.default),
    put: () => import("./commands/put.ts").then((m) => m.default),
    search: () => import("./commands/search.ts").then((m) => m.default),
    list: () => import("./commands/list.ts").then((m) => m.default),
    link: () => import("./commands/link.ts").then((m) => m.default),
    unlink: () => import("./commands/unlink.ts").then((m) => m.default),
    backlinks: () => import("./commands/backlinks.ts").then((m) => m.default),
    tag: () => import("./commands/tag.ts").then((m) => m.default),
    untag: () => import("./commands/untag.ts").then((m) => m.default),
    tags: () => import("./commands/tags.ts").then((m) => m.default),
    stats: () => import("./commands/stats.ts").then((m) => m.default),
    lint: () => import("./commands/lint.ts").then((m) => m.default),
    serve: () => import("./commands/serve.ts").then((m) => m.default),
    "setup-mcp": () => import("./commands/setup-mcp.ts").then((m) => m.default),
    embed: () => import("./commands/embed.ts").then((m) => m.default),
    query: () => import("./commands/query.ts").then((m) => m.default),
    harvest: () => import("./commands/harvest.ts").then((m) => m.default),
    digest: () => import("./commands/digest.ts").then((m) => m.default),
    export: () => import("./commands/export.ts").then((m) => m.default),
    import: () => import("./commands/import.ts").then((m) => m.default),
    version: () => import("./commands/version.ts").then((m) => m.default),
  },
});

runMain(main);
