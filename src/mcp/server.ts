import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Database } from "bun:sqlite";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { VERSION } from "../version.ts";
import { dispatchTool } from "../core/dispatch.ts";

export function createMcpServer(db: Database, dbPath: string): Server {
  const server = new Server(
    { name: "gbrain", version: VERSION },
    { capabilities: { tools: {} } }
  );
  const engine = new SqliteEngine(db);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "brain_search",
        description: "FTS5 full-text search across all pages in the knowledge brain",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            type:  { type: "string", description: "Optional: filter by page type" },
            limit: { type: "number", description: "Max results (default 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "brain_get",
        description: "Read a page by slug — returns compiled_truth + timeline as markdown. If slug not found, tries fuzzy match.",
        inputSchema: {
          type: "object",
          properties: {
            slug:  { type: "string", description: "Page slug" },
            fuzzy: { type: "boolean", description: "If true, fall back to FTS5 search when exact slug not found" },
          },
          required: ["slug"],
        },
      },
      {
        name: "brain_put",
        description: "Write or update a page (markdown with YAML frontmatter). Saves version history.",
        inputSchema: {
          type: "object",
          properties: {
            slug:     { type: "string", description: "Page slug" },
            content:  { type: "string", description: "Full markdown content with YAML frontmatter" },
            dry_run:  { type: "boolean", description: "Preview what would change without writing (default false)" },
          },
          required: ["slug", "content"],
        },
      },
      {
        name: "brain_delete",
        description: "Delete a page and all its links, tags, and embeddings",
        inputSchema: {
          type: "object",
          properties: {
            slug:    { type: "string", description: "Page slug to delete" },
            dry_run: { type: "boolean", description: "Preview what would be deleted without deleting (default false)" },
          },
          required: ["slug"],
        },
      },
      {
        name: "brain_list",
        description: "List pages with optional type/tag filters",
        inputSchema: {
          type: "object",
          properties: {
            type:  { type: "string", description: "Filter by type" },
            tag:   { type: "string", description: "Filter by tag" },
            limit: { type: "number", description: "Max results (default 20)" },
          },
        },
      },
      {
        name: "brain_link",
        description: "Create a cross-reference link between two pages",
        inputSchema: {
          type: "object",
          properties: {
            from:    { type: "string", description: "Source slug" },
            to:      { type: "string", description: "Target slug" },
            context: { type: "string", description: "Sentence context for the link" },
          },
          required: ["from", "to"],
        },
      },
      {
        name: "brain_unlink",
        description: "Remove a cross-reference link between two pages",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "string", description: "Source slug" },
            to:   { type: "string", description: "Target slug" },
          },
          required: ["from", "to"],
        },
      },
      {
        name: "brain_backlinks",
        description: "Get all pages that link to a given page",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string", description: "Target page slug" } },
          required: ["slug"],
        },
      },
      {
        name: "brain_tag",
        description: "Add a tag to a page",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Page slug" },
            tag:  { type: "string", description: "Tag to add" },
          },
          required: ["slug", "tag"],
        },
      },
      {
        name: "brain_untag",
        description: "Remove a tag from a page",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Page slug" },
            tag:  { type: "string", description: "Tag to remove" },
          },
          required: ["slug", "tag"],
        },
      },
      {
        name: "brain_tags",
        description: "List all tags, or tags for a specific page",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Optional page slug to get tags for" },
          },
        },
      },
      {
        name: "brain_timeline",
        description: "Get timeline entries for a page",
        inputSchema: {
          type: "object",
          properties: {
            slug:  { type: "string", description: "Page slug" },
            limit: { type: "number", description: "Max entries (default 20)" },
          },
          required: ["slug"],
        },
      },
      {
        name: "brain_versions",
        description: "List version history for a page",
        inputSchema: {
          type: "object",
          properties: {
            slug:  { type: "string", description: "Page slug" },
            limit: { type: "number", description: "Max versions (default 5)" },
          },
          required: ["slug"],
        },
      },
      {
        name: "brain_graph",
        description: "Get the link graph around a page (BFS to specified depth)",
        inputSchema: {
          type: "object",
          properties: {
            slug:  { type: "string", description: "Starting page slug (optional, omit for full graph)" },
            depth: { type: "number", description: "Traversal depth (default 2)" },
          },
        },
      },
      {
        name: "brain_stats",
        description: "Get brain statistics (page counts, DB size, embedding coverage)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "brain_health",
        description: "Get brain health report: stale pages, missing embeddings, orphans, broken links",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "brain_lint",
        description: "Get a detailed lint report: stale pages, low-confidence pages, orphaned pages",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "compile_inbox",
        description: "Process inbox items through LLM to create/update knowledge pages",
        inputSchema: {
          type: "object",
          properties: {
            limit:   { type: "number",  description: "Max items to process (default 20)" },
            dry_run: { type: "boolean", description: "Preview inbox count without processing (default false)" },
          },
        },
      },
      {
        name: "brain_hybrid_search",
        description: "Hybrid search: FTS5 keyword + vector merged with Reciprocal Rank Fusion. Best overall search. Requires embed API key for the vector leg.",
        inputSchema: {
          type: "object",
          properties: {
            query:     { type: "string", description: "Search query" },
            type:      { type: "string", description: "Optional: filter by page type" },
            limit:     { type: "number", description: "Max results (default 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "brain_export",
        description: "Export a page as a standalone markdown file with YAML frontmatter (round-trip safe)",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string", description: "Page slug" } },
          required: ["slug"],
        },
      },
      {
        name: "brain_keyword_search",
        description: "Fast FTS5 keyword search (no vector/semantic component)",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results (default 10)" },
          },
          required: ["query"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: input = {} } = req.params;
    try {
      return await dispatchTool(engine, dbPath, name, input as Record<string, unknown>);
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  });

  return server;
}

export async function startMcpServer(db: Database, dbPath: string): Promise<void> {
  const server = createMcpServer(db, dbPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
