import { defineCommand } from "citty";
import { existsSync } from "fs";
import { join } from "path";
import { openDb } from "../core/db.ts";
import { getFilesDir } from "../core/files.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { embed } from "../core/embedding.ts";
import { loadConfig } from "../core/config.ts";
import { serializePage } from "../core/markdown.ts";
import { UI_ASSETS, UI_ENTRY_PATH } from "../ui/generated.ts";
import type { SearchResult } from "../types.ts";

// ── Types ────────────────────────────────────────────────────────────────────

type SearchScope = "all" | "pages" | "sessions" | "files";
type BrowseSection = "recent" | "concept" | "session" | "inbox" | "file";
type RouteParams = Record<string, string>;
type RouteHandler = (req: Request, params: RouteParams) => Response | Promise<Response>;

interface AppContext {
  engine: SqliteEngine;
  db: ReturnType<typeof openDb>;
  hasEmbedKey: boolean;
}

// ── Tiny router ──────────────────────────────────────────────────────────────

/** Compile a path pattern like `/api/page/:slug` into a match function. */
function compilePath(pattern: string): (pathname: string) => RouteParams | null {
  const names: string[] = [];
  const src = pattern.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, (m) => {
    names.push(m.slice(1));
    return "([^/]+)";
  });
  const re = new RegExp(`^${src}$`);
  return (pathname) => {
    const m = re.exec(pathname);
    if (!m) return null;
    return Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
  };
}

class Router {
  private routes: Array<{ test: ReturnType<typeof compilePath>; handler: RouteHandler }> = [];

  get(path: string, handler: RouteHandler): this {
    this.routes.push({ test: compilePath(path), handler });
    return this;
  }

  dispatch(req: Request): Response | Promise<Response> {
    const { pathname } = new URL(req.url);
    for (const { test, handler } of this.routes) {
      const params = test(pathname);
      if (params !== null) return handler(req, params);
    }
    return new Response("Not found", { status: 404 });
  }
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

function parsePort(raw: string | undefined, fallback: number): number {
  const resolved = raw ?? String(fallback);
  const port = Number.parseInt(resolved, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port '${resolved}'. Expected an integer between 1 and 65535.`);
  }
  return port;
}

function parseLimit(raw: string | null, fallback = 20): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

function parseOffset(raw: string | null): number {
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function parseScope(raw: string | null): SearchScope {
  if (raw === "pages" || raw === "sessions" || raw === "files") return raw;
  return "all";
}

function parseBrowseSection(raw: string | null): BrowseSection {
  if (raw === "concept" || raw === "session" || raw === "inbox" || raw === "file") return raw;
  return "recent";
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function openCommand(url: string): string[] | null {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  if (process.platform === "linux") return ["xdg-open", url];
  return null;
}

function previewText(text: string, maxLen = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, clean.lastIndexOf(" ", maxLen) || maxLen) + "…";
}

function filterResults(results: SearchResult[], scope: SearchScope, limit: number): SearchResult[] {
  let filtered = results;
  if (scope === "pages") {
    filtered = results.filter((r) => r.result_kind !== "file" && r.type !== "session" && r.type !== "inbox");
  } else if (scope === "sessions") {
    filtered = results.filter((r) => r.result_kind !== "file" && r.type === "session");
  } else if (scope === "files") {
    filtered = results.filter((r) => r.result_kind === "file");
  }
  return filtered.slice(0, limit);
}

function assetHeaders(pathname: string, contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Cache-Control": pathname === UI_ENTRY_PATH ? "no-store" : "public, max-age=31536000, immutable",
  };
}

function uiAssetResponse(pathname: string): Response | null {
  const normalized = pathname === "/" ? UI_ENTRY_PATH : pathname;
  const asset = UI_ASSETS[normalized];
  if (!asset) return null;
  return new Response(Buffer.from(asset.body, "base64"), {
    headers: assetHeaders(normalized, asset.contentType),
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

function searchHandler(ctx: AppContext): RouteHandler {
  return async (req) => {
    const sp = new URL(req.url).searchParams;
    const query = (sp.get("q") ?? "").trim();
    const scope = parseScope(sp.get("scope"));
    const limit = parseLimit(sp.get("limit"), 20);

    if (!query) return Response.json({ results: [], degraded: false, warning: null });

    let degraded = !ctx.hasEmbedKey;
    let warning: string | null = !ctx.hasEmbedKey
      ? "Vector search unavailable: configure embed.api_key to improve ranking."
      : null;
    let embedding: Float32Array | null = null;

    if (ctx.hasEmbedKey) {
      try {
        embedding = await embed(query);
      } catch (err) {
        degraded = true;
        warning = `Vector search unavailable: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const rawLimit = scope === "all" || scope === "sessions" ? limit : Math.min(limit * 4, 100);
    const results = ctx.engine.hybridSearch(query, embedding, {
      limit: rawLimit,
      type: scope === "sessions" ? "session" : undefined,
    });

    return Response.json({ results: filterResults(results, scope, limit), degraded, warning });
  };
}

function pagesHandler(ctx: AppContext): RouteHandler {
  return (req) => {
    const sp = new URL(req.url).searchParams;
    const section = parseBrowseSection(sp.get("section"));
    const limit = parseLimit(sp.get("limit"), 50);
    const offset = parseOffset(sp.get("offset"));

    if (section === "file") {
      const files = ctx.engine.listFiles().slice(offset, offset + limit).map((file) => {
        const parent = ctx.db
          .query<{ page_slug: string | null; page_title: string | null }, [string]>(
            `SELECT pf.page_slug, p.title as page_title
             FROM page_files pf
             LEFT JOIN pages p ON p.slug = pf.page_slug
             WHERE pf.file_slug = ?
             ORDER BY pf.display_order LIMIT 1`
          )
          .get(file.slug);

        return {
          slug: `file:${file.slug}`,
          title: file.original_name ?? file.slug,
          type: "file",
          updated_at: file.created_at,
          has_files: false,
          preview: previewText(file.description ?? file.original_name ?? file.slug),
          parent_page_slug: parent?.page_slug ?? null,
          parent_page_title: parent?.page_title ?? null,
          mime_type: file.mime_type,
        };
      });
      return Response.json(files);
    }

    const pages = ctx.engine
      .listPages({ type: section === "recent" ? undefined : section, limit, offset })
      .map((page) => ({
        slug: page.slug,
        title: page.title,
        sidebar_title:
          typeof page.frontmatter.sidebar_title === "string"
            ? page.frontmatter.sidebar_title
            : undefined,
        type: page.type,
        updated_at: page.updated_at,
        has_files: ctx.engine.listFiles(page.slug).length > 0,
        preview: previewText(page.compiled_truth),
      }));
    return Response.json(pages);
  };
}

function summaryHandler(ctx: AppContext): RouteHandler {
  return () => {
    const stats = ctx.engine.getStats();
    const totalFiles = ctx.engine.listFiles().length;
    return Response.json({
      total_pages: stats.page_count ?? 0,
      total_files: totalFiles,
      embedded_pages: stats.embedded_count ?? 0,
      vector_enabled: ctx.hasEmbedKey,
      collections: {
        recent: stats.page_count ?? 0,
        concept: stats.byType["concept"] ?? 0,
        session: stats.byType["session"] ?? 0,
        inbox: stats.byType["inbox"] ?? 0,
        file: totalFiles,
      },
    });
  };
}

function fileRawHandler(ctx: AppContext): RouteHandler {
  return (_, params) => {
    const slug = decodeURIComponent(params.slug);
    const file = ctx.engine.getFile(slug);
    if (!file) return new Response("Not found", { status: 404 });

    const diskPath = join(getFilesDir(), file.file_path);
    if (!existsSync(diskPath)) return new Response("File missing on disk", { status: 404 });

    return new Response(Bun.file(diskPath), {
      headers: {
        "Content-Type": file.mime_type,
        "Content-Length": String(file.size_bytes),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.original_name ?? file.slug)}`,
        "Cache-Control": "no-store",
      },
    });
  };
}

function pageHandler(ctx: AppContext): RouteHandler {
  return (_, params) => {
    const slug = decodeURIComponent(params.slug);
    const page = ctx.engine.getPage(slug);
    if (!page) return new Response("Not found", { status: 404 });

    const files = ctx.engine.listFiles(page.slug);
    const links = ctx.engine.getLinks(page.slug);
    const backlinks = ctx.engine.getBacklinks(page.slug);
    const relatedSlugs = [
      ...new Set([...links.map((l) => l.to_slug), ...backlinks.map((l) => l.from_slug)]),
    ];
    const related = relatedSlugs
      .map((s) => ctx.engine.getPage(s))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .map((e) => ({ slug: e.slug, title: e.title, type: e.type }));

    const confidence =
      typeof page.frontmatter.confidence === "number" ? page.frontmatter.confidence : null;
    const lastVerified =
      typeof page.frontmatter.last_verified === "string" ? page.frontmatter.last_verified : null;
    const sources = Array.isArray(page.frontmatter.sources)
      ? page.frontmatter.sources.filter((v): v is string => typeof v === "string")
      : [];

    return Response.json({
      ...page,
      title: page.title,
      sidebar_title:
        typeof page.frontmatter.sidebar_title === "string"
          ? page.frontmatter.sidebar_title
          : undefined,
      markdown: serializePage(page),
      content: serializePage(page),
      metadata: {
        type: page.type,
        updated_at: page.updated_at,
        tags: Array.isArray(page.frontmatter.tags) ? page.frontmatter.tags : undefined,
        keywords: Array.isArray(page.frontmatter.keywords) ? page.frontmatter.keywords : undefined,
        has_files: files.length > 0,
        confidence,
        last_verified: lastVerified,
        source_count: sources.length,
      },
      files: files.map((f) => ({
        slug: f.slug,
        name: f.original_name ?? f.slug,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        download_url: `/api/file/${encodeURIComponent(f.slug)}/raw`,
      })),
      related,
    });
  };
}

// ── Static-asset fallback (non-API paths) ─────────────────────────────────────

function serveStatic(pathname: string): Response {
  const asset = uiAssetResponse(pathname);
  if (asset) return asset;
  // SPA: unknown non-dotfile paths → index.html
  if (!pathname.includes(".")) {
    return uiAssetResponse(UI_ENTRY_PATH) ?? new Response("UI assets not built", { status: 500 });
  }
  return new Response("Not found", { status: 404 });
}

// ── Command ───────────────────────────────────────────────────────────────────

export default defineCommand({
  meta: { name: "ui", description: "Start local web UI for knowledge browsing" },
  args: {
    db: { type: "string", description: "Path to brain.db" },
    port: { type: "string", description: "Port (default: ui.port or 7499)" },
    open: { type: "boolean", description: "Open browser automatically (use --no-open to disable)", default: true },
  },
  async run({ args }) {
    const cfg = loadConfig(args.db ? { db: args.db } : undefined);
    const dbPath = cfg.db.path;
    if (!dbPath) throw new Error("No database path configured.");

    const db = openDb(dbPath);
    const engine = new SqliteEngine(db);
    const port = parsePort(args.port, cfg.ui.port);
    const publicUrl = `http://localhost:${port}`;

    const isLocalEmbed =
      cfg.embed.base_url &&
      (cfg.embed.base_url.includes("localhost") || cfg.embed.base_url.includes("127.0.0.1"));
    const hasEmbedKey = !!cfg.embed.api_key || isLocalEmbed;

    const ctx: AppContext = { engine, db, hasEmbedKey };

    const router = new Router()
      .get("/api/search",        searchHandler(ctx))
      .get("/api/pages",         pagesHandler(ctx))
      .get("/api/summary",       summaryHandler(ctx))
      .get("/api/file/:slug/raw", fileRawHandler(ctx))
      .get("/api/page/:slug",    pageHandler(ctx));

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req) {
        if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
        const { pathname } = new URL(req.url);
        if (pathname.startsWith("/api/")) return router.dispatch(req);
        return serveStatic(pathname);
      },
    });

    let closed = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      server.stop(true);
      db.close();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    console.log(`exo UI -> ${publicUrl}`);
    console.log(`Bound to 127.0.0.1 only. Use SSH tunneling if you need remote access.`);

    if (args.open) {
      const command = openCommand(publicUrl);
      if (command) {
        try {
          Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
        } catch (err) {
          console.error(
            `⚠ Failed to open browser automatically: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    }

    await new Promise(() => {});
  },
});
