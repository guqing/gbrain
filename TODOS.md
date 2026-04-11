# TODOs

## v0.6 PDF / OCR ingestion

- **What:** Add PDF text extraction and OCR so imported PDFs become searchable content, not just generic attachments.
- **Why:** v0.5 intentionally stops at image understanding. PDF is the next obvious file type users expect to query semantically.
- **Pros:** Expands retrieval value for exported knowledge, validates the generic file pipeline beyond images, unlocks more real-world archives.
- **Cons:** Adds parser selection, OCR fallback, chunking rules, and larger failure surface than image-only v0.5.
- **Context:** The current plan stores PDFs as files but does not extract content. This should build on the same file metadata, provenance, and retrieval surfaces introduced by the importer framework.
- **Depends on / blocked by:** Land v0.5 file system + importer framework first.

## Second importer adapter validation

- **What:** Implement a second importer adapter after `import-chatgpt` to prove the framework is actually source-agnostic.
- **Why:** A generic importer framework is only real after a second adapter reuses it without ChatGPT-specific leakage.
- **Pros:** Validates runner boundaries, checkpoint model, and retrieval contracts under a different source shape.
- **Cons:** Touches parsing logic, source-specific mapping, and may expose abstractions that looked fine with only one adapter.
- **Context:** v0.5 builds the shared importer platform now, but only ships one adapter. The next adapter should intentionally stress the same runner and file/provenance model.
- **Depends on / blocked by:** v0.6 file extraction pipeline (ContentExtractor interface provides the right pattern to follow for importer adapters too).

## Audio / video transcript ingestion

- **What:** Add transcript extraction for audio and video attachments so media becomes searchable text.
- **Why:** This is a distinct multimodal pipeline, not a minor extension of image description.
- **Pros:** Broadens multimodal coverage, unlocks meeting recordings and voice notes, and makes file search meaningfully richer.
- **Cons:** Introduces duration-based cost, async processing pressure, format handling, and longer-running failure modes.
- **Context:** Now covered by v0.6 via AudioExtractor (Whisper API) and VideoExtractor (ffmpeg → audio pipe). This TODO can be marked done once v0.6 ships.
- **Depends on / blocked by:** v0.6 unified extraction pipeline.

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
