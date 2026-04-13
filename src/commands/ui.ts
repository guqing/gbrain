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

type SearchScope = "all" | "pages" | "sessions" | "files";
type BrowseSection = "recent" | "concept" | "session" | "inbox" | "file";

function parsePort(raw: string | undefined, fallback: number): number {
  const resolved = raw ?? String(fallback);
  const port = Number.parseInt(resolved, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port '${resolved}'. Expected an integer between 1 and 65535.`);
  }
  return port;
}

function openCommand(url: string): string[] | null {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  if (process.platform === "linux") return ["xdg-open", url];
  return null;
}

function parseLimit(raw: string | null, fallback = 20): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

function parseScope(raw: string | null): SearchScope {
  if (raw === "pages" || raw === "sessions" || raw === "files") return raw;
  return "all";
}

function parseBrowseSection(raw: string | null): BrowseSection {
  if (raw === "concept" || raw === "session" || raw === "inbox" || raw === "file") return raw;
  return "recent";
}

function parseOffset(raw: string | null): number {
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function previewText(text: string, maxLen = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, clean.lastIndexOf(" ", maxLen) || maxLen) + "…";
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

function filterResults(results: SearchResult[], scope: SearchScope, limit: number): SearchResult[] {
  let filtered = results;
  if (scope === "pages") {
    filtered = results.filter((result) =>
      result.result_kind !== "file" &&
      result.type !== "session" &&
      result.type !== "inbox"
    );
  } else if (scope === "sessions") {
    filtered = results.filter((result) => result.result_kind !== "file" && result.type === "session");
  } else if (scope === "files") {
    filtered = results.filter((result) => result.result_kind === "file");
  }
  return filtered.slice(0, limit);
}

export default defineCommand({
  meta: { name: "ui", description: "Start local web UI for knowledge browsing" },
  args: {
    db: { type: "string", description: "Path to brain.db" },
    port: { type: "string", description: "Port (default: ui.port or 7499)" },
    "no-open": { type: "boolean", description: "Don't open browser automatically", default: false },
  },
  async run({ args }) {
    const cfg = loadConfig(args.db ? { db: args.db } : undefined);
    const dbPath = cfg.db.path;
    if (!dbPath) {
      throw new Error("No database path configured.");
    }

    const db = openDb(dbPath);
    const engine = new SqliteEngine(db);
    const port = parsePort(args.port, cfg.ui.port);
    const publicUrl = `http://localhost:${port}`;

    const isLocalEmbed =
      cfg.embed.base_url &&
      (cfg.embed.base_url.includes("localhost") || cfg.embed.base_url.includes("127.0.0.1"));
    const hasEmbedKey = !!cfg.embed.api_key || isLocalEmbed;

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }

        if (url.pathname === "/api/search") {
          const query = (url.searchParams.get("q") ?? "").trim();
          const scope = parseScope(url.searchParams.get("scope"));
          const limit = parseLimit(url.searchParams.get("limit"), 20);
          if (!query) {
            return Response.json({ results: [], degraded: false, warning: null });
          }

          let degraded = !hasEmbedKey;
          let warning: string | null = !hasEmbedKey
            ? "Vector search unavailable: configure embed.api_key to improve ranking."
            : null;
          let embedding: Float32Array | null = null;

          if (hasEmbedKey) {
            try {
              embedding = await embed(query);
            } catch (error) {
              degraded = true;
              warning = `Vector search unavailable: ${error instanceof Error ? error.message : String(error)}`;
            }
          }

          const rawLimit = scope === "all" || scope === "sessions" ? limit : Math.min(limit * 4, 100);
          const type = scope === "sessions" ? "session" : undefined;
          const results = engine.hybridSearch(query, embedding, { limit: rawLimit, type });

          return Response.json({
            results: filterResults(results, scope, limit),
            degraded,
            warning,
          });
        }

        if (url.pathname === "/api/pages") {
          const section = parseBrowseSection(url.searchParams.get("section"));
          const limit = parseLimit(url.searchParams.get("limit"), 50);
          const offset = parseOffset(url.searchParams.get("offset"));

          if (section === "file") {
            const files = engine.listFiles().slice(offset, offset + limit).map((file) => {
              const parent = db
                .query<{ page_slug: string | null }, [string]>(
                  "SELECT page_slug FROM page_files WHERE file_slug = ? ORDER BY display_order LIMIT 1"
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
                mime_type: file.mime_type,
              };
            });
            return Response.json(files);
          }

          const pages = engine.listPages({
            type: section === "recent" ? undefined : section,
            limit,
            offset,
          }).map((page) => ({
            slug: page.slug,
            title: page.title,
            type: page.type,
            updated_at: page.updated_at,
            has_files: engine.listFiles(page.slug).length > 0,
            preview: previewText(page.compiled_truth),
          }));
          return Response.json(pages);
        }

        if (url.pathname === "/api/summary") {
          const stats = engine.getStats();
          const totalFiles = engine.listFiles().length;

          return Response.json({
            total_pages: stats.page_count ?? 0,
            total_files: totalFiles,
            embedded_pages: stats.embedded_count ?? 0,
            vector_enabled: hasEmbedKey,
            collections: {
              recent: stats.page_count ?? 0,
              concept: stats.byType["concept"] ?? 0,
              session: stats.byType["session"] ?? 0,
              inbox: stats.byType["inbox"] ?? 0,
              file: totalFiles,
            },
          });
        }

        if (url.pathname.startsWith("/api/file/") && url.pathname.endsWith("/raw")) {
          const slug = decodeURIComponent(url.pathname.slice("/api/file/".length, -"/raw".length));
          const file = engine.getFile(slug);
          if (!file) {
            return new Response("Not found", { status: 404 });
          }

          const diskPath = join(getFilesDir(), file.file_path);
          if (!existsSync(diskPath)) {
            return new Response("File missing on disk", { status: 404 });
          }

          return new Response(Bun.file(diskPath), {
            headers: {
              "Content-Type": file.mime_type,
              "Content-Length": String(file.size_bytes),
              "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.original_name ?? file.slug)}`,
              "Cache-Control": "no-store",
            },
          });
        }

        if (url.pathname.startsWith("/api/page/")) {
          const slug = decodeURIComponent(url.pathname.slice("/api/page/".length));
          const page = engine.getPage(slug);
          if (!page) {
            return new Response("Not found", { status: 404 });
          }

          const files = engine.listFiles(page.slug);
          const links = engine.getLinks(page.slug);
          const backlinks = engine.getBacklinks(page.slug);
          const relatedSlugs = [...new Set([...links.map((link) => link.to_slug), ...backlinks.map((link) => link.from_slug)])];
          const related = relatedSlugs
            .map((relatedSlug) => engine.getPage(relatedSlug))
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
            .map((entry) => ({
              slug: entry.slug,
              title: entry.title,
              type: entry.type,
            }));

          const confidence = typeof page.frontmatter.confidence === "number" ? page.frontmatter.confidence : null;
          const lastVerified = typeof page.frontmatter.last_verified === "string" ? page.frontmatter.last_verified : null;
          const sources = Array.isArray(page.frontmatter.sources)
            ? page.frontmatter.sources.filter((value): value is string => typeof value === "string")
            : [];

          return Response.json({
            ...page,
            title: page.title,
            markdown: serializePage(page),
            content: serializePage(page),
            metadata: {
              type: page.type,
              updated_at: page.updated_at,
              tags: Array.isArray(page.frontmatter.tags) ? page.frontmatter.tags : undefined,
              has_files: files.length > 0,
              confidence,
              last_verified: lastVerified,
              source_count: sources.length,
            },
            files: files.map((file) => ({
              slug: file.slug,
              name: file.original_name ?? file.slug,
              mime_type: file.mime_type,
              size_bytes: file.size_bytes,
              download_url: `/api/file/${encodeURIComponent(file.slug)}/raw`,
            })),
            related,
          });
        }

        const assetResponse = uiAssetResponse(url.pathname);
        if (assetResponse) {
          return assetResponse;
        }

        if (!url.pathname.startsWith("/api/") && !url.pathname.includes(".")) {
          return uiAssetResponse(UI_ENTRY_PATH) ?? new Response("UI assets not built", { status: 500 });
        }

        return new Response("Not found", { status: 404 });
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

    if (!args["no-open"]) {
      const command = openCommand(publicUrl);
      if (command) {
        try {
          Bun.spawn(command, {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          });
        } catch (error) {
          console.error(`⚠ Failed to open browser automatically: ${error instanceof Error ? error.message : error}`);
        }
      }
    }

    await new Promise(() => {});
  },
});
