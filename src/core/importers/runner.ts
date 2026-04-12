import { copyFileSync, mkdirSync, readFileSync } from "fs";
import { extname, basename } from "path";
import { join } from "path";
import type { SqliteEngine } from "../sqlite-engine.ts";
import type { ImportAdapter, ImportUnit, ImportRunStatus } from "./types.ts";
import type { VisionConfig, FetchFn } from "../vision.ts";
import { describeAndEmbedFile } from "../file-processing.ts";
import { getMimeType, isImageMime, fileHash, baseSlug, resolveFileSlug, getFilesDir } from "../files.ts";

export interface RunnerOptions {
  describe?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  maxImages?: number;
  fetchFn?: FetchFn;
  visionCfg?: VisionConfig;
  embedModel?: string;
  onProgress?: (completed: number, failed: number, total: number, lastSlug: string) => void;
}

export interface RunResult {
  runId: number;
  status: ImportRunStatus;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  imagesAttached: number;
  imagesUnmatched: number;
}

export class ImportRunner {
  constructor(
    private engine: SqliteEngine,
    private adapter: ImportAdapter,
  ) {}

  async run(
    sourceRef: string,
    opts: RunnerOptions = {},
    resumeRunId?: number,
  ): Promise<RunResult> {
    const {
      describe = false,
      dryRun = false,
      onProgress,
      fetchFn,
      visionCfg,
      embedModel = "text-embedding-3-small",
    } = opts;

    const filesDir = getFilesDir();
    if (!dryRun) {
      mkdirSync(filesDir, { recursive: true });
    }

    // Create or resume import run
    let runId: number;
    let resuming = false;

    if (resumeRunId !== undefined) {
      const existing = this.engine.getImportRun(resumeRunId);
      if (!existing) throw new Error(`Import run ${resumeRunId} not found`);
      runId = resumeRunId;
      resuming = true;
      if (!dryRun) {
        this.engine.updateImportRunStatus(runId, "running");
      }
    } else {
      if (!dryRun) {
        const run = this.engine.createImportRun(this.adapter.source_type, sourceRef, 0);
        runId = run.id;
      } else {
        runId = -1;
      }
    }

    let total = 0;
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let imagesAttached = 0;
    let imagesUnmatched = 0;

    let interrupted = false;
    const handleSigint = () => {
      interrupted = true;
    };
    process.on("SIGINT", handleSigint);

    try {
      for await (const unit of this.adapter.scan(sourceRef)) {
        if (interrupted) break;
        total++;

        // Check cross-run checkpoint
        if (!dryRun) {
          const checkpoint = this.engine.getImportCheckpoint(
            this.adapter.source_type,
            sourceRef,
            unit.item_key,
          );
          if (checkpoint?.status === "completed") {
            skipped++;
            onProgress?.(completed, failed, total, unit.page_slug);
            continue;
          }
        }

        if (dryRun) {
          completed++;
          onProgress?.(completed, failed, total, unit.page_slug);
          continue;
        }

        // Unit transaction: page write + file links + checkpoint
        try {
          this.engine.db.exec("BEGIN");

          // Write page
          this.engine.putPage(unit.page_slug, unit.page_input);

          // Process attachments
          for (const att of unit.attachments) {
            const ext = extname(att.file_path);
            const mime = getMimeType(att.file_path);
            if (!mime) {
              imagesUnmatched++;
              continue;
            }

            let content: Buffer;
            try {
              content = readFileSync(att.file_path);
            } catch {
              imagesUnmatched++;
              continue;
            }

            const sha256 = fileHash(content);
            const slug = resolveFileSlug(baseSlug(att.file_path), ext, filesDir);
            const relPath = `${slug}${ext}`;
            const diskPath = join(filesDir, relPath);

            let fileSlug: string;
            try {
              copyFileSync(att.file_path, diskPath);
              const result = this.engine.attachFileRecord(unit.page_slug, {
                slug,
                sha256,
                file_path: relPath,
                original_name: basename(att.file_path),
                mime_type: mime,
                size_bytes: content.length,
                description: null,
                processed_at: null,
              });
              fileSlug = result.slug;
              imagesAttached++;
            } catch (err) {
              if (String(err).includes("UNIQUE constraint failed: files.slug")) {
                // TOCTOU: cleanup orphaned disk file
                try { require("fs").rmSync(diskPath, { force: true }); } catch {}
              }
              imagesUnmatched++;
              continue;
            }

            this.engine.recordFileReference(unit.page_slug, fileSlug, {
              source_type: this.adapter.source_type,
              source_ref: unit.item_key,
              source_item_id: att.source_item_id,
              source_role: att.source_role,
            });
          }

          this.engine.upsertImportRunItem(runId, unit.item_key, unit.item_type, "completed", {
            page_slug: unit.page_slug,
          });
          this.engine.upsertImportCheckpoint({
            source_type: this.adapter.source_type,
            source_ref: sourceRef,
            item_key: unit.item_key,
            item_type: unit.item_type,
            status: "completed",
            page_slug: unit.page_slug,
            last_run_id: runId,
          });

          this.engine.db.exec("COMMIT");
          completed++;
        } catch (err) {
          this.engine.db.exec("ROLLBACK");
          const msg = err instanceof Error ? err.message : String(err);
          this.engine.upsertImportRunItem(runId, unit.item_key, unit.item_type, "failed", {
            error_message: msg,
            retryable: true,
          });
          failed++;
        }

        onProgress?.(completed, failed, total, unit.page_slug);

        // Update run totals every 10 items
        if (total % 10 === 0) {
          this.engine.updateImportRunCounts(runId, total, completed, failed);
        }
      }
    } finally {
      process.off("SIGINT", handleSigint);
    }

    if (!dryRun) {
      this.engine.updateImportRunCounts(runId, total, completed, failed);
    }

    // Describe images after import if requested
    if (describe && !dryRun && visionCfg && imagesAttached > 0) {
      const undescribed = this.engine.listUndescribedFiles();
      for (const f of undescribed) {
        if (!isImageMime(f.mime_type)) continue;
        await describeAndEmbedFile(
          this.engine,
          f.slug,
          filesDir,
          visionCfg,
          embedModel,
          fetchFn,
        ).catch(() => {/* non-fatal, description stays null */});
      }
    }

    const finalStatus: ImportRunStatus = interrupted
      ? "interrupted"
      : failed > 0
        ? "completed_with_errors"
        : "completed";

    if (!dryRun) {
      const summary =
        `Imported ${completed} conversations, ${imagesAttached} images attached` +
        (imagesUnmatched > 0 ? `, ${imagesUnmatched} images unmatched` : "");
      this.engine.updateImportRunStatus(runId, finalStatus, summary);
    }

    return { runId, status: finalStatus, total, completed, failed, skipped, imagesAttached, imagesUnmatched };
  }
}
