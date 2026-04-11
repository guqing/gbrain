# TODOs

## Second importer adapter validation

- **What:** Implement a second importer adapter after `import-chatgpt` to prove the framework is actually source-agnostic.
- **Why:** A generic importer framework is only real after a second adapter reuses it without ChatGPT-specific leakage.
- **Pros:** Validates runner boundaries, checkpoint model, and retrieval contracts under a different source shape.
- **Cons:** Touches parsing logic, source-specific mapping, and may expose abstractions that looked fine with only one adapter.
- **Context:** v0.5 builds the shared importer platform now, but only ships one adapter. The next adapter should intentionally stress the same runner and file/provenance model.
- **Depends on / blocked by:** v0.6 file extraction pipeline (ContentExtractor interface provides the right pattern to follow for importer adapters too).

## PDF OCR fallback (v0.6.1)

- **What:** When PDF text extraction yields 0 chunks (scanned-image PDFs), attempt OCR via tesseract.js.
- **Why:** Users attaching scanned PDFs get 0 chunks with no explanation — silent failure, bad experience.
- **Pros:** Covers scanned documents and book-scan PDFs; reuses v0.6 ContentExtractor interface (OcrExtractor adapter).
- **Cons:** tesseract.js is ~50MB WASM; accuracy depends on image quality; complex layouts often produce garbled text.
- **Context:** v0.6 PDFExtractor should warn the user when extraction yields 0 text ("PDF appears to be scanned — OCR support coming"). This TODO implements the OCR fallback.
- **Depends on / blocked by:** v0.6 file extraction pipeline.

## Large audio file chunked upload (v0.6.1)

- **What:** When audio exceeds Whisper API's 25MB limit, split with ffmpeg, transcribe in segments, merge time-stamped chunks.
- **Why:** Meeting recordings are commonly 50–200MB. Current behavior: clear error. Should be automatic.
- **Pros:** Unlocks long recordings; ffmpeg pipe pattern already established in v0.6 video.ts.
- **Cons:** Timestamp offset calculation across split boundaries; sentence truncation at split edges.
- **Context:** v0.6 AudioExtractor should throw a clear error for >25MB: "file exceeds Whisper 25MB limit — chunked upload support coming in v0.6.1". This TODO implements the chunking.
- **Depends on / blocked by:** v0.6 AudioExtractor.

## Completed

### v0.6 PDF / OCR ingestion
- **What:** Add PDF text extraction and OCR so imported PDFs become searchable content, not just generic attachments.
- **Completed:** v0.6.0.0 (2026-04-11) — PdfExtractor (unpdf), per-page chunking, FTS5 indexing.

### Audio / video transcript ingestion
- **What:** Add transcript extraction for audio and video attachments so media becomes searchable text.
- **Completed:** v0.6.0.0 (2026-04-11) — AudioExtractor (Whisper API), VideoExtractor (ffmpeg → wav pipe).
