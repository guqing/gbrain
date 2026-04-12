import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { slugify } from "../utils.ts";
import type { ImportAdapter, ImportUnit } from "./types.ts";

// ── ChatGPT export types ────────────────────────────────────────────────────

interface ChatGPTMessage {
  id?: string;
  author?: { role?: string; name?: string };
  content?: {
    content_type?: string;
    parts?: unknown[];
    text?: string;
  };
  create_time?: number;
}

interface ChatGPTNode {
  id?: string;
  message?: ChatGPTMessage | null;
  parent?: string | null;
  children?: string[];
}

interface ChatGPTConversation {
  id?: string;
  title?: string;
  create_time?: number;
  mapping?: Record<string, ChatGPTNode>;
}

// ── File index ──────────────────────────────────────────────────────────────

export function buildFileIndex(exportDir: string): Map<string, string> {
  const index = new Map<string, string>();
  let entries: string[];
  try {
    entries = readdirSync(exportDir);
  } catch {
    return index;
  }

  for (const name of entries) {
    // Pattern A: file-{fileId}-anything.ext
    const matchA = name.match(/^file-([A-Za-z0-9]+)-/);
    if (matchA?.[1]) {
      index.set(matchA[1], join(exportDir, name));
      continue;
    }
    // Pattern B: hash#file_{numericId}#page.hash.ext
    const matchB = name.match(/#file_(\d+)#/);
    if (matchB?.[1]) {
      index.set(matchB[1], join(exportDir, name));
    }
  }

  return index;
}

// ── Message tree traversal ──────────────────────────────────────────────────

function walkMessages(mapping: Record<string, ChatGPTNode>): ChatGPTNode[] {
  // Find root node(s): no parent, or parent = "client-created-root", or parent not in mapping
  const rootIds = Object.keys(mapping).filter((id) => {
    const node = mapping[id]!;
    return !node.parent || node.parent === "client-created-root" || !mapping[node.parent];
  });

  const ordered: ChatGPTNode[] = [];
  const visited = new Set<string>();

  function walk(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = mapping[id];
    if (!node) return;
    if (node.message) ordered.push(node);
    for (const childId of node.children ?? []) {
      walk(childId);
    }
  }

  for (const rootId of rootIds) {
    walk(rootId);
  }

  return ordered;
}

function extractTextFromMessage(msg: ChatGPTMessage): string {
  if (!msg.content) return "";
  if (typeof msg.content === "string") return msg.content;

  if (msg.content.content_type === "text") {
    const parts = msg.content.parts;
    if (Array.isArray(parts)) {
      return parts
        .filter((p): p is string => typeof p === "string")
        .join("\n");
    }
    return msg.content.text ?? "";
  }

  // Multimodal: text parts only
  if (Array.isArray(msg.content.parts)) {
    return msg.content.parts
      .filter((p): p is string => typeof p === "string")
      .join("\n");
  }

  return "";
}

function extractImageRefs(
  mapping: Record<string, ChatGPTNode>,
  fileIndex: Map<string, string>,
): Array<{ nodeId: string; filePath: string; role: string }> {
  const refs: Array<{ nodeId: string; filePath: string; role: string }> = [];

  for (const [nodeId, node] of Object.entries(mapping)) {
    if (!node.message?.content) continue;
    const parts = node.message.content.parts;
    if (!Array.isArray(parts)) continue;
    const role = node.message.author?.role ?? "unknown";

    for (const part of parts) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;
      if (p["content_type"] !== "image_asset_pointer") continue;
      const ptr = typeof p["asset_pointer"] === "string" ? p["asset_pointer"] : "";
      // asset_pointer format: "file-service://file-{fileId}"
      const fileIdMatch = ptr.match(/file-([A-Za-z0-9]+)$/);
      if (!fileIdMatch?.[1]) continue;
      const filePath = fileIndex.get(fileIdMatch[1]);
      if (filePath) {
        refs.push({ nodeId, filePath, role });
      }
    }
  }

  return refs;
}

function conversationToMarkdown(
  title: string,
  nodes: ChatGPTNode[],
): string {
  const lines: string[] = [`# ${title}`, ""];

  for (const node of nodes) {
    if (!node.message) continue;
    const role = node.message.author?.role ?? "unknown";
    if (role === "tool" || role === "system") continue;

    const text = extractTextFromMessage(node.message);
    if (!text.trim()) continue;

    const label = role === "user" ? "**User**" : "**Assistant**";
    lines.push(`${label}:\n${text.trim()}`, "");
  }

  return lines.join("\n");
}

// ── Find conversations JSON files ───────────────────────────────────────────

export function findConversationFiles(exportDir: string): string[] {
  try {
    return readdirSync(exportDir)
      .filter((name) => name.startsWith("conversations") && name.endsWith(".json"))
      .map((name) => join(exportDir, name));
  } catch {
    return [];
  }
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class ChatGPTAdapter implements ImportAdapter {
  readonly source_type = "chatgpt";

  async *scan(exportDir: string): AsyncIterable<ImportUnit> {
    const fileIndex = buildFileIndex(exportDir);
    const convFiles = findConversationFiles(exportDir);

    for (const convFile of convFiles) {
      let conversations: ChatGPTConversation[];
      try {
        const raw = readFileSync(convFile, "utf-8");
        conversations = JSON.parse(raw) as ChatGPTConversation[];
        if (!Array.isArray(conversations)) {
          console.error(`⚠ Unexpected format in ${convFile}, skipping`);
          continue;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`⚠ Failed to parse ${convFile}: ${msg}`);
        continue;
      }

      for (const conv of conversations) {
        const convId = conv.id ?? "";
        if (!convId) continue;

        const title = conv.title?.trim() || `ChatGPT conversation ${convId.slice(0, 8)}`;
        const mapping = conv.mapping ?? {};

        const nodes = walkMessages(mapping);
        const content = conversationToMarkdown(title, nodes);
        const imageRefs = extractImageRefs(mapping, fileIndex);

        const pageSlug = `chatgpt/${slugify(title)}-${convId.slice(0, 8)}`;

        yield {
          item_key: convId,
          item_type: "conversation",
          page_slug: pageSlug,
          page_input: {
            type: "session",
            title,
            compiled_truth: content,
          },
          attachments: imageRefs.map((ref) => ({
            file_path: ref.filePath,
            source_item_id: ref.nodeId,
            source_role: ref.role,
          })),
        };
      }
    }
  }
}
