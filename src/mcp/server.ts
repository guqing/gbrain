import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Database } from "bun:sqlite";
import { ftsSearch } from "../core/fts.ts";
import { rowToPage, serializePage, parsePage, frontmatterToJson } from "../core/markdown.ts";
import { createLink, getBacklinks } from "../core/links.ts";
import type { PageRow, BrainStats } from "../types.ts";
import { statSync } from "fs";

export function createMcpServer(db: Database, dbPath: string): Server {
  const server = new Server(
    { name: "gbrain", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "brain_search",
        description: "FTS5 full-text search across all pages in the knowledge brain",
        inputSchema: {
          type: "object",
          properties: {
            query:  { type: "string",  description: "Search query" },
            type:   { type: "string",  description: "Optional: filter by page type" },
            limit:  { type: "number",  description: "Max results (default 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "brain_get",
        description: "Read a page by slug",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string", description: "Page slug" } },
          required: ["slug"],
        },
      },
      {
        name: "brain_put",
        description: "Write or update a page (markdown with YAML frontmatter)",
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
        name: "brain_stats",
        description: "Get brain statistics (page counts, DB size, etc.)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "brain_lint_summary",
        description: "Get a summary of stale, orphaned, and low-confidence pages",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: input = {} } = req.params;

    try {
      if (name === "brain_search") {
        const results = ftsSearch(db, input["query"] as string, {
          type: input["type"] as string | undefined,
          limit: (input["limit"] as number | undefined) ?? 10,
        });
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      if (name === "brain_get") {
        const row = db.query<PageRow, [string]>("SELECT * FROM pages WHERE slug = ? LIMIT 1").get(input["slug"] as string);
        if (!row) return { content: [{ type: "text", text: `Page not found: ${input["slug"]}` }], isError: true };
        return { content: [{ type: "text", text: serializePage(rowToPage(row)) }] };
      }

      if (name === "brain_put") {
        const slug = input["slug"] as string;
        const content = input["content"] as string;
        const parsed = parsePage(content, slug);
        const existing = db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1").get(slug);
        if (existing) {
          db.run(
            `UPDATE pages SET type=?,title=?,compiled_truth=?,timeline=?,frontmatter=?,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE slug=?`,
            [parsed.type, parsed.title, parsed.compiled_truth, parsed.timeline, frontmatterToJson(parsed.frontmatter), slug]
          );
          return { content: [{ type: "text", text: `Updated: ${slug}` }] };
        } else {
          db.run(
            "INSERT INTO pages (slug,type,title,compiled_truth,timeline,frontmatter) VALUES (?,?,?,?,?,?)",
            [slug, parsed.type, parsed.title, parsed.compiled_truth, parsed.timeline, frontmatterToJson(parsed.frontmatter)]
          );
          return { content: [{ type: "text", text: `Created: ${slug}` }] };
        }
      }

      if (name === "brain_list") {
        const limit = (input["limit"] as number | undefined) ?? 20;
        let rows: PageRow[];
        if (input["tag"]) {
          rows = db.query<PageRow, [string]>(`SELECT p.* FROM pages p JOIN tags t ON t.page_id=p.id WHERE t.tag=? ${input["type"] ? `AND p.type='${input["type"]}'` : ""} ORDER BY p.updated_at DESC LIMIT ${limit}`).all(input["tag"] as string);
        } else if (input["type"]) {
          rows = db.query<PageRow, [string]>(`SELECT * FROM pages WHERE type=? ORDER BY updated_at DESC LIMIT ${limit}`).all(input["type"] as string);
        } else {
          rows = db.query<PageRow, []>(`SELECT * FROM pages ORDER BY updated_at DESC LIMIT ${limit}`).all();
        }
        const summary = rows.map(r => ({ slug: r.slug, type: r.type, title: r.title, updated_at: r.updated_at }));
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      }

      if (name === "brain_link") {
        const result = createLink(db, input["from"] as string, input["to"] as string, (input["context"] as string) ?? "");
        return { content: [{ type: "text", text: result.ok ? `Linked: ${input["from"]} → ${input["to"]}` : result.error ?? "Error" }], isError: !result.ok };
      }

      if (name === "brain_stats") {
        const total = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM pages").get()?.n ?? 0;
        const byType = Object.fromEntries(db.query<{ type: string; n: number }, []>("SELECT type, COUNT(*) as n FROM pages GROUP BY type").all().map(r => [r.type, r.n]));
        const links = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM links").get()?.n ?? 0;
        let dbSize = 0;
        try { dbSize = statSync(dbPath).size; } catch { /* */ }
        const stats: BrainStats = { totalPages: total, byType, totalLinks: links, totalTags: 0, totalEmbeddings: 0, totalIngestLog: 0, dbSizeBytes: dbSize };
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      }

      if (name === "brain_lint_summary") {
        const today = new Date().toISOString().slice(0, 10)!;
        const allPages = db.query<PageRow, []>("SELECT * FROM pages").all();
        let staleCount = 0, lowConfCount = 0;
        for (const row of allPages) {
          let fm: { valid_until?: string; confidence?: number } = {};
          try { fm = JSON.parse(row.frontmatter); } catch { /* */ }
          if (fm.valid_until && fm.valid_until < today) staleCount++;
          if (fm.confidence !== undefined && fm.confidence < 5) lowConfCount++;
        }
        const linkedSlugs = new Set(db.query<{ slug: string }, []>("SELECT DISTINCT p.slug FROM pages p JOIN links l ON l.to_page_id=p.id").all().map(r => r.slug));
        const orphans = allPages.filter(r => !linkedSlugs.has(r.slug)).length;
        return { content: [{ type: "text", text: `Stale: ${staleCount}, Low confidence: ${lowConfCount}, Orphans: ${orphans}` }] };
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
  // Server runs until process exits
}
