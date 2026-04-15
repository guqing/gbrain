import { defineCommand } from "citty";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "fs";
import { basename, extname, join, relative, resolve } from "path";
import { openDb, resolveDbPath } from "../core/db.ts";
import { SqliteEngine } from "../core/sqlite-engine.ts";
import { loadConfig } from "../core/config.ts";
import {
  baseSlug,
  fileHash,
  getFilesDir,
  getMimeType,
  isImageMime,
  resolveFileSlug,
} from "../core/files.ts";
import { registry } from "../core/extractors/index.ts";
import { generateInboxSlug, deconflictSlug, slugify } from "../core/utils.ts";

// ── File type categories ───────────────────────────────────────────────────

const TEXT_EXTS = new Set([".md", ".txt", ".markdown", ".mdx"]);

function isTextFile(filePath: string): boolean {
  return TEXT_EXTS.has(extname(filePath).toLowerCase());
}

function isBinaryFile(filePath: string): boolean {
  const mime = getMimeType(filePath);
  if (!mime) return false;
  return registry.supports(mime) || isImageMime(mime);
}

// ── Directory walker ───────────────────────────────────────────────────────

interface FoundFile {
  path: string;
  relPath: string;
  kind: "text" | "binary";
}

function walkDir(dir: string): FoundFile[] {
  const result: FoundFile[] = [];
  function walk(current: string) {
    try {
      for (const ent of readdirSync(current, { withFileTypes: true })) {
        if (ent.name.startsWith(".")) continue;
        const full = join(current, ent.name);
        if (ent.isDirectory()) {
          walk(full);
        } else if (isTextFile(full)) {
          result.push({ path: full, relPath: relative(dir, full), kind: "text" });
        } else if (isBinaryFile(full)) {
          result.push({ path: full, relPath: relative(dir, full), kind: "binary" });
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  walk(dir);
  return result;
}

// ── Command ────────────────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: "ingest",
    description:
      "Ingest a directory into the inbox for LLM processing (.md/.txt → inbox directly; PDF/image/audio → attach + extract → inbox)",
  },
  args: {
    path: {
      type: "positional",
      description: "Directory (or single file) to ingest",
      required: true,
    },
    db: { type: "string", description: "Path to brain.db" },
    "dry-run": {
      type: "boolean",
      description: "Preview what would be ingested without writing",
      default: false,
    },
    "no-describe": {
      type: "boolean",
      description: "Skip AI extraction for binary files (attach only, no content)",
      default: false,
    },
  },
  async run({ args }) {
    const inputPath = resolve(args.path);
    const dryRun = args["dry-run"] as boolean;
    const skipDescribe = args["no-describe"] as boolean;

    if (!existsSync(inputPath)) {
      console.error(`✗ Not found: ${inputPath}`);
      process.exit(1);
    }

    const engine = new SqliteEngine(openDb(resolveDbPath(args.db)));
    const cfg = loadConfig();
    const filesDir = getFilesDir();

    // Collect files
    const stat = statSync(inputPath);
    let files: FoundFile[];
    if (stat.isDirectory()) {
      files = walkDir(inputPath);
    } else {
      const kind = isTextFile(inputPath) ? "text" : isBinaryFile(inputPath) ? "binary" : null;
      if (!kind) {
        console.error(`✗ Unsupported file type: ${extname(inputPath) || "(no extension)"}`);
        process.exit(1);
      }
      files = [{ path: inputPath, relPath: basename(inputPath), kind }];
    }

    if (files.length === 0) {
      console.log("No ingestable files found.");
      console.log("  Supported: .md .txt .markdown .mdx | PDF/DOCX/image/audio");
      return;
    }

    const textFiles = files.filter(f => f.kind === "text");
    const binaryFiles = files.filter(f => f.kind === "binary");

    console.log(`Found ${files.length} file(s)  (${textFiles.length} text, ${binaryFiles.length} binary)`);
    if (dryRun) console.log("  [DRY-RUN — no writes]\n");

    const visionReady = !skipDescribe && !!cfg.vision?.api_key;
    if (binaryFiles.length > 0 && !skipDescribe && !cfg.vision?.api_key) {
      console.log(`  ⚠  Vision/extraction API not configured — binary files will be attached without content extraction.`);
      console.log(`     Set with: exo config set vision.api_key <key>\n`);
    }

    let created = 0;
    let attached = 0;
    let skipped = 0;

    // ── Text files → inbox ─────────────────────────────────────────────────
    if (textFiles.length > 0) {
      console.log(`\n── Text files → inbox ─────────────────────────────────`);
    }
    for (const file of textFiles) {
      const content = readFileSync(file.path, "utf-8");
      if (!content.trim()) { skipped++; continue; }

      const title = basename(file.relPath, extname(file.relPath));

      if (dryRun) {
        console.log(`[DRY-RUN] Would inbox: ${file.relPath}  (${content.length} chars)`);
        continue;
      }

      const inboxSlug = deconflictSlug(
        generateInboxSlug(content),
        (s) => !!engine.getPage(s),
      );
      engine.putPage(inboxSlug, {
        type: "inbox",
        title,
        compiled_truth: content,
      });
      engine.logIngest({
        source_type: "ingest-text",
        source_ref: file.path,
        pages_updated: [inboxSlug],
        summary: `ingest: ${file.relPath} → inbox`,
      });
      created++;
      console.log(`✓ inbox: ${inboxSlug}  ← ${file.relPath}`);
    }

    // ── Binary files → attach → extract → inbox ────────────────────────────
    if (binaryFiles.length > 0) {
      console.log(`\n── Binary files → attach + extract → inbox ────────────`);
    }
    if (!dryRun) {
      mkdirSync(filesDir, { recursive: true });
    }

    for (const file of binaryFiles) {
      const ext = extname(file.path);
      const mime = getMimeType(file.path)!;
      const title = basename(file.relPath, ext);

      if (dryRun) {
        const action = visionReady ? "attach + extract" : "attach only";
        console.log(`[DRY-RUN] Would ${action}: ${file.relPath}  (${mime})`);
        continue;
      }

      const fileContent = readFileSync(file.path);
      const sha256 = fileHash(fileContent);

      // Create a transient inbox page to hang the file from
      const pageSlug = deconflictSlug(
        `inbox/${slugify(title)}`,
        (s) => !!engine.getPage(s),
      );
      engine.putPage(pageSlug, {
        type: "inbox",
        title,
        compiled_truth: `# ${title}\n\n*File: ${basename(file.path)}*\n`,
      });

      // Attach file
      const fSlug = resolveFileSlug(baseSlug(file.path), ext, filesDir);
      const relPath = `${fSlug}${ext}`;
      const diskPath = join(filesDir, relPath);
      copyFileSync(file.path, diskPath);
      engine.attachFileRecord(pageSlug, {
        slug: fSlug,
        sha256,
        file_path: relPath,
        original_name: basename(file.path),
        mime_type: mime,
        size_bytes: statSync(file.path).size,
        description: null,
        processed_at: null,
      });
      attached++;

      // Extract content directly via extractor and update inbox page body
      const extractor = registry.get(mime);
      const canExtract = extractor || isImageMime(mime);
      if (canExtract && (visionReady || (extractor && !isImageMime(mime)))) {
        try {
          const visionCfg = cfg.vision?.api_key
            ? { api_key: cfg.vision.api_key, base_url: cfg.vision.base_url, model: cfg.vision.model }
            : undefined;
          const chunks = extractor
            ? await extractor.extract(diskPath, { visionConfig: visionCfg } as Parameters<typeof extractor.extract>[1])
            : [];
          if (chunks.length > 0) {
            const extractedText = chunks.map((c: { text: string }) => c.text).join("\n\n");
            engine.putPage(pageSlug, {
              type: "inbox",
              title,
              compiled_truth: `# ${title}\n\n*Source: ${basename(file.path)}*\n\n${extractedText}`,
            });
            console.log(`✓ inbox+extract: ${pageSlug}  ← ${file.relPath}  (${chunks.length} chunk${chunks.length === 1 ? "" : "s"})`);
          } else {
            console.log(`✓ inbox (no extract): ${pageSlug}  ← ${file.relPath}`);
          }
        } catch (err) {
          console.log(`✓ inbox (extract failed): ${pageSlug}  ⚠ ${err}`);
        }
      } else {
        console.log(`✓ inbox (attached): ${pageSlug}  ← ${file.relPath}`);
      }

      engine.logIngest({
        source_type: "ingest-binary",
        source_ref: file.path,
        pages_updated: [pageSlug],
        summary: `ingest: ${file.relPath} → inbox (${mime})`,
      });
      created++;
    }

    if (dryRun) return;

    const total = created + skipped;
    console.log(`\n✓ Ingest complete: ${created} item${created === 1 ? "" : "s"} added to inbox${skipped > 0 ? `, ${skipped} empty files skipped` : ""}.`);
    if (binaryFiles.length > 0) {
      console.log(`  ${attached} binary file${attached === 1 ? "" : "s"} attached.`);
    }
    console.log(`  Run 'exo inbox' to review, 'exo compile' to process.`);
  },
});
