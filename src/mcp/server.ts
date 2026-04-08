import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Database } from "bun:sqlite";
import { ftsSearch } from "../core/fts.ts";
import { rowToPage, serializePage, parsePage, frontmatterToJson } from "../core/markdown.ts";
import { createLink, getBacklinks, removeLink } from "../core/links.ts";
import { keywordSearch } from "../core/search/keyword.ts";
import type { PageRow, BrainStats } from "../types.ts";
import { statSync } from "fs";
import { SqliteEngine } from "../core/sqlite-engine.ts";

export function createMcpServer(db: Database, dbPath: string): Server {
  const server = new Server(
    { name: "gbrain", version: "0.2.0" },
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
        const results = ftsSearch(db, input["query"] as string, {
          type: input["type"] as string | undefined,
          limit: (input["limit"] as number | undefined) ?? 10,
        });
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      // --- brain_keyword_search ---
      if (name === "brain_keyword_search") {
        const results = keywordSearch(db, input["query"] as string, (input["limit"] as number | undefined) ?? 10);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      // --- brain_get ---
      if (name === "brain_get") {
        const row = db
          .query<PageRow, [string]>("SELECT * FROM pages WHERE slug = ? LIMIT 1")
          .get(input["slug"] as string);
        if (!row) {
          return { content: [{ type: "text", text: `Page not found: ${input["slug"]}` }], isError: true };
        }
        return { content: [{ type: "text", text: serializePage(rowToPage(row)) }] };
      }

      // --- brain_put ---
      if (name === "brain_put") {
        const slug = input["slug"] as string;
        const content = input["content"] as string;
        const parsed = parsePage(content, slug);
        const existing = db
          .query<{ id: number; compiled_truth: string; timeline: string; frontmatter: string }, [string]>(
            "SELECT id, compiled_truth, timeline, frontmatter FROM pages WHERE slug = ? LIMIT 1"
          )
          .get(slug);

        if (existing) {
          // Save version
          db.prepare(
            "INSERT INTO page_versions (page_id, compiled_truth, timeline, frontmatter) VALUES (?,?,?,?)"
          ).run(existing.id, existing.compiled_truth, existing.timeline, existing.frontmatter);

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

      // --- brain_delete ---
      if (name === "brain_delete") {
        const slug = input["slug"] as string;
        const row = db
          .query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?")
          .get(slug);
        if (!row) {
          return { content: [{ type: "text", text: `Page not found: ${slug}` }], isError: true };
        }
        db.prepare("DELETE FROM pages WHERE id = ?").run(row.id);
        return { content: [{ type: "text", text: `Deleted: ${slug}` }] };
      }

      // --- brain_list ---
      if (name === "brain_list") {
        const limit = (input["limit"] as number | undefined) ?? 20;
        let rows: PageRow[];
        if (input["tag"]) {
          rows = db
            .query<PageRow, [string]>(
              `SELECT p.* FROM pages p JOIN tags t ON t.page_id=p.id WHERE t.tag=? ${
                input["type"] ? `AND p.type='${input["type"]}'` : ""
              } ORDER BY p.updated_at DESC LIMIT ${limit}`
            )
            .all(input["tag"] as string);
        } else if (input["type"]) {
          rows = db
            .query<PageRow, [string]>(
              `SELECT * FROM pages WHERE type=? ORDER BY updated_at DESC LIMIT ${limit}`
            )
            .all(input["type"] as string);
        } else {
          rows = db
            .query<PageRow, []>(`SELECT * FROM pages ORDER BY updated_at DESC LIMIT ${limit}`)
            .all();
        }
        const summary = rows.map((r) => ({
          slug: r.slug,
          type: r.type,
          title: r.title,
          updated_at: r.updated_at,
        }));
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      }

      // --- brain_link ---
      if (name === "brain_link") {
        const result = createLink(
          db,
          input["from"] as string,
          input["to"] as string,
          (input["context"] as string) ?? ""
        );
        return {
          content: [{ type: "text", text: result.ok ? `Linked: ${input["from"]} → ${input["to"]}` : (result.error ?? "Error") }],
          isError: !result.ok,
        };
      }

      // --- brain_unlink ---
      if (name === "brain_unlink") {
        const result = removeLink(db, input["from"] as string, input["to"] as string);
        return {
          content: [{ type: "text", text: result.ok ? `Unlinked: ${input["from"]} ↛ ${input["to"]}` : (result.error ?? "Error") }],
          isError: !result.ok,
        };
      }

      // --- brain_backlinks ---
      if (name === "brain_backlinks") {
        const links = getBacklinks(db, input["slug"] as string);
        return { content: [{ type: "text", text: JSON.stringify(links, null, 2) }] };
      }

      // --- brain_tag ---
      if (name === "brain_tag") {
        const page = db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(input["slug"] as string);
        if (!page) return { content: [{ type: "text", text: `Page not found: ${input["slug"]}` }], isError: true };
        db.prepare("INSERT OR IGNORE INTO tags (page_id, tag) VALUES (?, ?)").run(page.id, input["tag"] as string);
        return { content: [{ type: "text", text: `Tagged ${input["slug"]} with #${input["tag"]}` }] };
      }

      // --- brain_untag ---
      if (name === "brain_untag") {
        const page = db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(input["slug"] as string);
        if (!page) return { content: [{ type: "text", text: `Page not found: ${input["slug"]}` }], isError: true };
        db.prepare("DELETE FROM tags WHERE page_id = ? AND tag = ?").run(page.id, input["tag"] as string);
        return { content: [{ type: "text", text: `Removed tag #${input["tag"]} from ${input["slug"]}` }] };
      }

      // --- brain_tags ---
      if (name === "brain_tags") {
        if (input["slug"]) {
          const page = db.query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ?").get(input["slug"] as string);
          if (!page) return { content: [{ type: "text", text: `Page not found: ${input["slug"]}` }], isError: true };
          const tags = db.query<{ tag: string }, [number]>("SELECT tag FROM tags WHERE page_id = ? ORDER BY tag").all(page.id);
          return { content: [{ type: "text", text: tags.map((t) => t.tag).join(", ") || "(no tags)" }] };
        }
        const all = db.query<{ tag: string; n: number }, []>("SELECT tag, COUNT(*) as n FROM tags GROUP BY tag ORDER BY n DESC LIMIT 50").all();
        return { content: [{ type: "text", text: JSON.stringify(all, null, 2) }] };
      }

      // --- brain_timeline ---
      if (name === "brain_timeline") {
        const slug = input["slug"] as string;
        const limit = (input["limit"] as number | undefined) ?? 20;
        const page = db.query<{ id: number; title: string; timeline: string }, [string]>(
          "SELECT id, title, timeline FROM pages WHERE slug = ?"
        ).get(slug);
        if (!page) return { content: [{ type: "text", text: `Page not found: ${slug}` }], isError: true };

        const entries = db.query<{ entry_date: string; source: string; content: string }, [number, number]>(
          "SELECT entry_date, source, content FROM timeline_entries WHERE page_id = ? ORDER BY entry_date DESC LIMIT ?"
        ).all(page.id, limit);

        if (entries.length > 0) {
          const text = entries.map((e) => `**${e.entry_date}**${e.source ? ` [${e.source}]` : ""}\n${e.content}`).join("\n\n");
          return { content: [{ type: "text", text }] };
        }
        return { content: [{ type: "text", text: page.timeline || "(no timeline entries)" }] };
      }

      // --- brain_versions ---
      if (name === "brain_versions") {
        const slug = input["slug"] as string;
        const limit = (input["limit"] as number | undefined) ?? 5;
        const page = db.query<{ id: number; title: string }, [string]>("SELECT id, title FROM pages WHERE slug = ?").get(slug);
        if (!page) return { content: [{ type: "text", text: `Page not found: ${slug}` }], isError: true };

        const versions = db.query<{ id: number; created_at: string }, [number, number]>(
          "SELECT id, created_at FROM page_versions WHERE page_id = ? ORDER BY created_at DESC LIMIT ?"
        ).all(page.id, limit);

        if (versions.length === 0) return { content: [{ type: "text", text: "No versions saved yet." }] };

        const list = versions.map((v, i) => `${i + 1}. ${v.created_at}`).join("\n");
        return { content: [{ type: "text", text: `Versions for ${slug}:\n${list}` }] };
      }

      // --- brain_graph ---
      if (name === "brain_graph") {
        const startSlug = input["slug"] as string | undefined;
        const maxDepth = (input["depth"] as number | undefined) ?? 2;

        const allLinks = db.query<{ from_slug: string; to_slug: string }, []>(
          `SELECT fp.slug as from_slug, tp.slug as to_slug
           FROM links l
           JOIN pages fp ON fp.id = l.from_page_id
           JOIN pages tp ON tp.id = l.to_page_id`
        ).all();

        const linksFrom = new Map<string, string[]>();
        const linksTo = new Map<string, string[]>();
        for (const l of allLinks) {
          if (!linksFrom.has(l.from_slug)) linksFrom.set(l.from_slug, []);
          if (!linksTo.has(l.to_slug)) linksTo.set(l.to_slug, []);
          linksFrom.get(l.from_slug)!.push(l.to_slug);
          linksTo.get(l.to_slug)!.push(l.from_slug);
        }

        let slugs: string[];
        if (startSlug) {
          const visited = new Set<string>([startSlug]);
          const queue: Array<{ slug: string; depth: number }> = [{ slug: startSlug, depth: 0 }];
          while (queue.length > 0) {
            const { slug, depth } = queue.shift()!;
            if (depth >= maxDepth) continue;
            for (const n of [...(linksFrom.get(slug) ?? []), ...(linksTo.get(slug) ?? [])]) {
              if (!visited.has(n)) { visited.add(n); queue.push({ slug: n, depth: depth + 1 }); }
            }
          }
          slugs = Array.from(visited);
        } else {
          slugs = db.query<{ slug: string }, []>("SELECT slug FROM pages ORDER BY slug").all().map((r) => r.slug);
        }

        const pages = db.query<{ slug: string; type: string; title: string }, []>("SELECT slug, type, title FROM pages").all();
        const pageMap = new Map(pages.map((p) => [p.slug, p]));

        const nodes = slugs.map((slug) => {
          const meta = pageMap.get(slug);
          return { slug, type: meta?.type ?? "unknown", title: meta?.title ?? slug, links: linksFrom.get(slug) ?? [], backlinks: linksTo.get(slug) ?? [] };
        });

        return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
      }

      // --- brain_stats ---
      if (name === "brain_stats") {
        const total = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM pages").get()?.n ?? 0;
        const byType = Object.fromEntries(
          db.query<{ type: string; n: number }, []>("SELECT type, COUNT(*) as n FROM pages GROUP BY type").all().map((r) => [r.type, r.n])
        );
        const links = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM links").get()?.n ?? 0;
        const embeddings = db.query<{ n: number }, []>("SELECT COUNT(DISTINCT page_id) as n FROM page_embeddings").get()?.n ?? 0;
        const ingestLog = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM ingest_log").get()?.n ?? 0;
        let dbSize = 0;
        try { dbSize = statSync(dbPath).size; } catch { /* */ }
        const stats: BrainStats = { totalPages: total, byType, totalLinks: links, totalTags: 0, totalEmbeddings: embeddings, totalIngestLog: ingestLog, dbSizeBytes: dbSize };
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      }

      // --- brain_health ---
      if (name === "brain_health") {
        const total = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM pages").get()?.n ?? 0;
        const withEmb = db.query<{ n: number }, []>("SELECT COUNT(DISTINCT page_id) as n FROM page_embeddings").get()?.n ?? 0;
        const now = new Date().toISOString().split("T")[0]!;
        const stale = db.query<{ n: number }, [string]>("SELECT COUNT(*) as n FROM pages WHERE json_extract(frontmatter, '$.valid_until') < ?").get(now)?.n ?? 0;
        const lowConf = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM pages WHERE json_extract(frontmatter, '$.confidence') < 5 AND json_extract(frontmatter, '$.confidence') IS NOT NULL").get()?.n ?? 0;
        const embPct = total > 0 ? Math.round((withEmb / total) * 100) : 0;
        const lines = [
          `Total pages: ${total}`,
          `Embeddings: ${withEmb}/${total} (${embPct}%)${withEmb < total ? " — run 'gbrain embed' to fill gaps" : " ✓"}`,
          `Stale pages: ${stale}${stale > 0 ? " ⚠" : " ✓"}`,
          `Low confidence: ${lowConf}${lowConf > 0 ? " ⚠" : " ✓"}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // --- brain_lint ---
      if (name === "brain_lint") {
        const today = new Date().toISOString().slice(0, 10)!;
        const allPages = db.query<PageRow, []>("SELECT * FROM pages").all();
        const stale: string[] = [];
        const lowConf: string[] = [];
        for (const row of allPages) {
          let fm: { valid_until?: string; confidence?: number } = {};
          try { fm = JSON.parse(row.frontmatter); } catch { /* */ }
          if (fm.valid_until && fm.valid_until < today) stale.push(`${row.slug} (expires ${fm.valid_until})`);
          if (fm.confidence !== undefined && fm.confidence < 5) lowConf.push(`${row.slug} (confidence ${fm.confidence})`);
        }
        const linkedSlugs = new Set(
          db.query<{ slug: string }, []>("SELECT DISTINCT p.slug FROM pages p JOIN links l ON l.to_page_id=p.id").all().map((r) => r.slug)
        );
        const orphans = allPages.filter((r) => !linkedSlugs.has(r.slug)).map((r) => r.slug);

        const parts = [
          `Stale (${stale.length}): ${stale.join(", ") || "none"}`,
          `Low confidence (${lowConf.length}): ${lowConf.join(", ") || "none"}`,
          `Orphans (${orphans.length}): ${orphans.slice(0, 10).join(", ") || "none"}`,
        ];
        return { content: [{ type: "text", text: parts.join("\n") }] };
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
