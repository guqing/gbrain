/**
 * Shared MCP tool dispatcher — single source of truth for tool handler logic.
 * Used by both the MCP server (src/mcp/server.ts) and the CLI `exo call` command.
 *
 * Returns a result object matching MCP's CallToolResult shape:
 *   { content: [{ type: "text", text: string }], isError?: boolean }
 *
 * This module is a lightweight precursor to the full contract-first operations.ts refactor.
 */

import { statSync } from "fs";
import { SqliteEngine } from "./sqlite-engine.ts";
import { serializePage, parsePage } from "./markdown.ts";
import { runCompile } from "../commands/compile/index.ts";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export async function dispatchTool(
  engine: SqliteEngine,
  dbPath: string,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  // --- brain_search ---
  if (name === "brain_search") {
    const results = engine.searchKeyword(input["query"] as string, {
      type: input["type"] as string | undefined,
      limit: (input["limit"] as number | undefined) ?? 10,
    });
    return ok(JSON.stringify(results, null, 2));
  }

  // --- brain_keyword_search ---
  if (name === "brain_keyword_search") {
    const results = engine.searchKeyword(input["query"] as string, {
      limit: (input["limit"] as number | undefined) ?? 10,
    });
    return ok(JSON.stringify(results, null, 2));
  }

  // --- brain_hybrid_search ---
  if (name === "brain_hybrid_search") {
    const query = input["query"] as string;
    const limit = (input["limit"] as number | undefined) ?? 10;
    const type = input["type"] as string | undefined;
    const results = engine.hybridSearch(query, null, { limit, type });
    return ok(JSON.stringify(results, null, 2));
  }

  // --- brain_get ---
  if (name === "brain_get") {
    const slug = input["slug"] as string;
    const fuzzy = !!(input["fuzzy"] as boolean | undefined);

    if (fuzzy) {
      const result = engine.getPageFuzzy(slug);
      if (!result) return err(`Page not found: ${slug} (fuzzy search also found nothing)`);
      const prefix =
        result.resolved_slug !== slug
          ? `<!-- resolved from "${slug}" to "${result.resolved_slug}" -->\n`
          : "";
      return ok(prefix + serializePage(result.page));
    }

    const page = engine.getPage(slug);
    if (!page) return err(`Page not found: ${slug}`);
    return ok(serializePage(page));
  }

  // --- brain_put ---
  if (name === "brain_put") {
    const slug = input["slug"] as string;
    const content = input["content"] as string;
    const dry_run = !!(input["dry_run"] as boolean | undefined);
    const parsed = parsePage(content, slug);
    const isUpdate = !!engine.getPage(slug);

    if (dry_run) {
      return ok(
        JSON.stringify(
          {
            action: isUpdate ? "update" : "create",
            slug,
            would_create_version: isUpdate,
            title: parsed.title,
            type: parsed.type,
          },
          null,
          2,
        ),
      );
    }

    if (isUpdate) engine.createVersion(slug);
    engine.putPage(slug, {
      type: parsed.type,
      title: parsed.title,
      compiled_truth: parsed.compiled_truth,
      timeline: parsed.timeline,
      frontmatter: parsed.frontmatter,
    });
    return ok(`${isUpdate ? "Updated" : "Created"}: ${slug}`);
  }

  // --- brain_delete ---
  if (name === "brain_delete") {
    const slug = input["slug"] as string;
    const dry_run = !!(input["dry_run"] as boolean | undefined);
    const page = engine.getPage(slug);
    if (!page) return err(`Page not found: ${slug}`);

    if (dry_run) {
      const links = engine.getLinks(slug);
      const backlinks = engine.getBacklinks(slug);
      const tags = engine.getTags(slug);
      return ok(
        JSON.stringify(
          {
            would_delete: slug,
            title: page.title,
            outgoing_links: links.length,
            incoming_links: backlinks.length,
            tags: tags.length,
          },
          null,
          2,
        ),
      );
    }

    engine.deletePage(slug);
    return ok(`Deleted: ${slug}`);
  }

  // --- brain_list ---
  if (name === "brain_list") {
    const pages = engine.listPages({
      type: input["type"] as string | undefined,
      tag: input["tag"] as string | undefined,
      limit: (input["limit"] as number | undefined) ?? 20,
    });
    const summary = pages.map((p) => ({
      slug: p.slug,
      type: p.type,
      title: p.title,
      updated_at: p.updated_at,
    }));
    return ok(JSON.stringify(summary, null, 2));
  }

  // --- brain_link ---
  if (name === "brain_link") {
    try {
      engine.addLink(
        input["from"] as string,
        input["to"] as string,
        (input["context"] as string) ?? "",
      );
      return ok(`Linked: ${input["from"]} -> ${input["to"]}`);
    } catch (e) {
      return err(String(e));
    }
  }

  // --- brain_unlink ---
  if (name === "brain_unlink") {
    try {
      engine.removeLink(input["from"] as string, input["to"] as string);
      return ok(`Unlinked: ${input["from"]} !-> ${input["to"]}`);
    } catch {
      return err("Link not found");
    }
  }

  // --- brain_backlinks ---
  if (name === "brain_backlinks") {
    const links = engine.getBacklinks(input["slug"] as string);
    return ok(JSON.stringify(links, null, 2));
  }

  // --- brain_tag ---
  if (name === "brain_tag") {
    if (!engine.getPage(input["slug"] as string))
      return err(`Page not found: ${input["slug"]}`);
    engine.addTag(input["slug"] as string, input["tag"] as string);
    return ok(`Tagged ${input["slug"]} with #${input["tag"]}`);
  }

  // --- brain_untag ---
  if (name === "brain_untag") {
    if (!engine.getPage(input["slug"] as string))
      return err(`Page not found: ${input["slug"]}`);
    engine.removeTag(input["slug"] as string, input["tag"] as string);
    return ok(`Removed tag #${input["tag"]} from ${input["slug"]}`);
  }

  // --- brain_tags ---
  if (name === "brain_tags") {
    if (input["slug"]) {
      if (!engine.getPage(input["slug"] as string))
        return err(`Page not found: ${input["slug"]}`);
      const tags = engine.getTags(input["slug"] as string);
      return ok(tags.join(", ") || "(no tags)");
    }
    const stats = engine.getStats();
    return ok(JSON.stringify({ total_tags: stats.totalTags, by_type: stats.byType }, null, 2));
  }

  // --- brain_timeline ---
  if (name === "brain_timeline") {
    const slug = input["slug"] as string;
    const limit = (input["limit"] as number | undefined) ?? 20;
    if (!engine.getPage(slug)) return err(`Page not found: ${slug}`);
    const entries = engine.getTimeline(slug, { limit });
    if (entries.length > 0) {
      const text = entries
        .map(
          (e) =>
            `**${e.entry_date}**${e.source ? ` [${e.source}]` : ""}\n${e.summary}${e.detail ? "\n" + e.detail : ""}`,
        )
        .join("\n\n");
      return ok(text);
    }
    return ok("(no timeline entries)");
  }

  // --- brain_versions ---
  if (name === "brain_versions") {
    const slug = input["slug"] as string;
    const limit = (input["limit"] as number | undefined) ?? 5;
    if (!engine.getPage(slug)) return err(`Page not found: ${slug}`);
    const versions = engine.getVersions(slug).slice(0, limit);
    if (versions.length === 0) return ok("No versions saved yet.");
    const list = versions.map((v, i) => `${i + 1}. ${v.snapshot_at}`).join("\n");
    return ok(`Versions for ${slug}:\n${list}`);
  }

  // --- brain_graph ---
  if (name === "brain_graph") {
    const startSlug = input["slug"] as string | undefined;
    const maxDepth = (input["depth"] as number | undefined) ?? 2;
    const nodes = engine.traverseGraph(startSlug ?? "", maxDepth);
    return ok(JSON.stringify(nodes, null, 2));
  }

  // --- brain_stats ---
  if (name === "brain_stats") {
    const stats = engine.getStats();
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(dbPath).size;
    } catch {
      /* ignore */
    }
    stats.dbSizeBytes = dbSizeBytes;
    return ok(JSON.stringify(stats, null, 2));
  }

  // --- brain_health ---
  if (name === "brain_health") {
    const health = engine.getHealth();
    const embPct = health.page_count > 0 ? Math.round(health.embed_coverage * 100) : 0;
    const embeddedPages = Math.round(health.page_count * health.embed_coverage);
    const lines = [
      `Total pages: ${health.page_count}`,
      `Embeddings: ${embeddedPages}/${health.page_count} (${embPct}%)${health.missing_embeddings > 0 ? " -- run 'exo embed' to fill gaps" : " ✓"}`,
      `Stale pages: ${health.stale_pages}${health.stale_pages > 0 ? " !" : " ✓"}`,
      `Missing embeddings: ${health.missing_embeddings}${health.missing_embeddings > 0 ? " !" : " ✓"}`,
    ];
    return ok(lines.join("\n"));
  }

  // --- brain_lint ---
  if (name === "brain_lint") {
    const report = engine.getLintReport();
    const parts = [
      `Stale (${report.stale.length}): ${report.stale.map((p) => `${p.slug} (expires ${p.valid_until})`).join(", ") || "none"}`,
      `Low confidence (${report.lowConfidence.length}): ${report.lowConfidence.map((p) => `${p.slug} (confidence ${p.confidence})`).join(", ") || "none"}`,
      `Orphans (${report.orphans.length}): ${report.orphans.slice(0, 10).join(", ") || "none"}`,
      `Inbox queue: ${report.inbox_queue.count} items${report.inbox_queue.oldest_date ? ` (oldest: ${report.inbox_queue.oldest_date.slice(0, 10)})` : ""}`,
    ];
    return ok(parts.join("\n"));
  }

  // --- compile_inbox ---
  if (name === "compile_inbox") {
    const limit = (input["limit"] as number) ?? 20;
    const dry_run = !!(input["dry_run"] as boolean | undefined);

    if (dry_run) {
      const inboxPages = engine.listPages({ type: "inbox", limit: 1000 });
      return ok(
        JSON.stringify(
          {
            inbox_count: inboxPages.length,
            would_process: Math.min(inboxPages.length, limit),
            run: `exo compile --limit ${limit}`,
          },
          null,
          2,
        ),
      );
    }

    const result = await runCompile({ limit, yes: true, interactive: false, dbPath });
    const text = `Processed: ${result.processed}, Created: ${result.created}, Updated: ${result.updated}, Noise: ${result.noise}${result.errors.length ? `\nErrors: ${result.errors.join("; ")}` : ""}`;
    return ok(text);
  }

  // --- brain_export ---
  if (name === "brain_export") {
    const slug = input["slug"] as string;
    const page = engine.getPage(slug);
    if (!page) return err(`Page not found: ${slug}`);
    return ok(serializePage(page));
  }

  return err(`Unknown tool: ${name}`);
}
