import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Database } from "bun:sqlite";
import { serializePage, parsePage } from "../core/markdown.ts";
import { statSync } from "fs";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { VERSION } from "../version.ts";
import { runCompile } from "../commands/compile/index.ts";

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
        description: "Read a page by slug — returns compiled_truth + timeline as markdown",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string", description: "Page slug" } },
          required: ["slug"],
        },
      },
      {
        name: "brain_put",
        description: "Write or update a page (markdown with YAML frontmatter). Saves version history.",
        inputSchema: {
          type: "object",
          properties: {
            slug:    { type: "string", description: "Page slug" },
            content: { type: "string", description: "Full markdown content with YAML frontmatter" },
          },
          required: ["slug", "content"],
        },
      },
      {
        name: "brain_delete",
        description: "Delete a page and all its links, tags, and embeddings",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string", description: "Page slug to delete" } },
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
            limit: { type: "number", description: "Max items to process (default 20)" },
          },
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
      // --- brain_search ---
      if (name === "brain_search") {
        const results = engine.searchKeyword(input["query"] as string, {
          type: input["type"] as string | undefined,
          limit: (input["limit"] as number | undefined) ?? 10,
        });
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      // --- brain_keyword_search ---
      if (name === "brain_keyword_search") {
        const results = engine.searchKeyword(input["query"] as string, { limit: (input["limit"] as number | undefined) ?? 10 });
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      // --- brain_get ---
      if (name === "brain_get") {
        const page = engine.getPage(input["slug"] as string);
        if (!page) {
          return { content: [{ type: "text", text: `Page not found: ${input["slug"]}` }], isError: true };
        }
        return { content: [{ type: "text", text: serializePage(page) }] };
      }

      // --- brain_put ---
      if (name === "brain_put") {
        const slug = input["slug"] as string;
        const content = input["content"] as string;
        const parsed = parsePage(content, slug);
        const isUpdate = !!engine.getPage(slug);

        if (isUpdate) {
          engine.createVersion(slug);
        }
        engine.putPage(slug, {
          type: parsed.type,
          title: parsed.title,
          compiled_truth: parsed.compiled_truth,
          timeline: parsed.timeline,
          frontmatter: parsed.frontmatter,
        });
        return { content: [{ type: "text", text: `${isUpdate ? "Updated" : "Created"}: ${slug}` }] };
      }

      // --- brain_delete ---
      if (name === "brain_delete") {
        const slug = input["slug"] as string;
        if (!engine.getPage(slug)) {
          return { content: [{ type: "text", text: `Page not found: ${slug}` }], isError: true };
        }
        engine.deletePage(slug);
        return { content: [{ type: "text", text: `Deleted: ${slug}` }] };
      }

      // --- brain_list ---
      if (name === "brain_list") {
        const pages = engine.listPages({
          type: input["type"] as string | undefined,
          tag: input["tag"] as string | undefined,
          limit: (input["limit"] as number | undefined) ?? 20,
        });
        const summary = pages.map((p) => ({ slug: p.slug, type: p.type, title: p.title, updated_at: p.updated_at }));
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      }

      // --- brain_link ---
      if (name === "brain_link") {
        try {
          engine.addLink(input["from"] as string, input["to"] as string, (input["context"] as string) ?? "");
          return { content: [{ type: "text", text: `Linked: ${input["from"]} -> ${input["to"]}` }] };
        } catch (e) {
          return { content: [{ type: "text", text: String(e) }], isError: true };
        }
      }

      // --- brain_unlink ---
      if (name === "brain_unlink") {
        try {
          engine.removeLink(input["from"] as string, input["to"] as string);
          return { content: [{ type: "text", text: `Unlinked: ${input["from"]} !-> ${input["to"]}` }] };
        } catch {
          return { content: [{ type: "text", text: "Link not found" }], isError: true };
        }
      }

      // --- brain_backlinks ---
      if (name === "brain_backlinks") {
        const links = engine.getBacklinks(input["slug"] as string);
        return { content: [{ type: "text", text: JSON.stringify(links, null, 2) }] };
      }

      // --- brain_tag ---
      if (name === "brain_tag") {
        if (!engine.getPage(input["slug"] as string)) {
          return { content: [{ type: "text", text: `Page not found: ${input["slug"]}` }], isError: true };
        }
        engine.addTag(input["slug"] as string, input["tag"] as string);
        return { content: [{ type: "text", text: `Tagged ${input["slug"]} with #${input["tag"]}` }] };
      }

      // --- brain_untag ---
      if (name === "brain_untag") {
        if (!engine.getPage(input["slug"] as string)) {
          return { content: [{ type: "text", text: `Page not found: ${input["slug"]}` }], isError: true };
        }
        engine.removeTag(input["slug"] as string, input["tag"] as string);
        return { content: [{ type: "text", text: `Removed tag #${input["tag"]} from ${input["slug"]}` }] };
      }

      // --- brain_tags ---
      if (name === "brain_tags") {
        if (input["slug"]) {
          if (!engine.getPage(input["slug"] as string)) {
            return { content: [{ type: "text", text: `Page not found: ${input["slug"]}` }], isError: true };
          }
          const tags = engine.getTags(input["slug"] as string);
          return { content: [{ type: "text", text: tags.join(", ") || "(no tags)" }] };
        }
        // Global tag stats
        const stats = engine.getStats();
        const tagStats = { total_tags: stats.totalTags, by_type: stats.byType };
        return { content: [{ type: "text", text: JSON.stringify(tagStats, null, 2) }] };
      }

      // --- brain_timeline ---
      if (name === "brain_timeline") {
        const slug = input["slug"] as string;
        const limit = (input["limit"] as number | undefined) ?? 20;
        if (!engine.getPage(slug)) {
          return { content: [{ type: "text", text: `Page not found: ${slug}` }], isError: true };
        }
        const entries = engine.getTimeline(slug, { limit });
        if (entries.length > 0) {
          const text = entries.map((e) => `**${e.entry_date}**${e.source ? ` [${e.source}]` : ""}\n${e.summary}${e.detail ? "\n" + e.detail : ""}`).join("\n\n");
          return { content: [{ type: "text", text }] };
        }
        return { content: [{ type: "text", text: "(no timeline entries)" }] };
      }

      // --- brain_versions ---
      if (name === "brain_versions") {
        const slug = input["slug"] as string;
        const limit = (input["limit"] as number | undefined) ?? 5;
        if (!engine.getPage(slug)) {
          return { content: [{ type: "text", text: `Page not found: ${slug}` }], isError: true };
        }
        const versions = engine.getVersions(slug).slice(0, limit);
        if (versions.length === 0) return { content: [{ type: "text", text: "No versions saved yet." }] };
        const list = versions.map((v, i) => `${i + 1}. ${v.snapshot_at}`).join("\n");
        return { content: [{ type: "text", text: `Versions for ${slug}:\n${list}` }] };
      }

      // --- brain_graph ---
      if (name === "brain_graph") {
        const startSlug = input["slug"] as string | undefined;
        const maxDepth = (input["depth"] as number | undefined) ?? 2;
        const nodes = engine.traverseGraph(startSlug ?? "", maxDepth);
        return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
      }

      // --- brain_stats ---
      if (name === "brain_stats") {
        const stats = engine.getStats();
        let dbSizeBytes = 0;
        try { dbSizeBytes = statSync(dbPath).size; } catch { /* */ }
        stats.dbSizeBytes = dbSizeBytes;
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      }

      // --- brain_health ---
      if (name === "brain_health") {
        const health = engine.getHealth();
        const embPct = health.page_count > 0 ? Math.round(health.embed_coverage * 100) : 0;
        const embeddedPages = Math.round(health.page_count * health.embed_coverage);
        const lines = [
          `Total pages: ${health.page_count}`,
          `Embeddings: ${embeddedPages}/${health.page_count} (${embPct}%)${health.missing_embeddings > 0 ? " -- run 'gbrain embed' to fill gaps" : " ✓"}`,
          `Stale pages: ${health.stale_pages}${health.stale_pages > 0 ? " !" : " ✓"}`,
          `Missing embeddings: ${health.missing_embeddings}${health.missing_embeddings > 0 ? " !" : " ✓"}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

            // --- brain_lint ---
      if (name === "brain_lint") {
        const report = engine.getLintReport();
        const parts = [
          `Stale (${report.stale.length}): ${report.stale.map(p => `${p.slug} (expires ${p.valid_until})`).join(", ") || "none"}`,
          `Low confidence (${report.lowConfidence.length}): ${report.lowConfidence.map(p => `${p.slug} (confidence ${p.confidence})`).join(", ") || "none"}`,
          `Orphans (${report.orphans.length}): ${report.orphans.slice(0, 10).join(", ") || "none"}`,
          `Inbox queue: ${report.inbox_queue.count} items${report.inbox_queue.oldest_date ? ` (oldest: ${report.inbox_queue.oldest_date.slice(0, 10)})` : ""}`,
        ];
        return { content: [{ type: "text", text: parts.join("\n") }] };
      }

      // --- compile_inbox ---
      if (name === "compile_inbox") {
        const limit = (input["limit"] as number) ?? 20;
        const result = await runCompile({ limit, yes: true, interactive: false, dbPath: dbPath });
        const text = `Processed: ${result.processed}, Created: ${result.created}, Updated: ${result.updated}, Noise: ${result.noise}${result.errors.length ? `\nErrors: ${result.errors.join("; ")}` : ""}`;
        return { content: [{ type: "text", text }] };
      }

      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };

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
