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
- **Depends on / blocked by:** v0.5 importer runner, checkpoints, and retrieval surfaces must land first.

## Audio / video transcript ingestion

- **What:** Add transcript extraction for audio and video attachments so media becomes searchable text.
- **Why:** This is a distinct multimodal pipeline, not a minor extension of image description.
- **Pros:** Broadens multimodal coverage, unlocks meeting recordings and voice notes, and makes file search meaningfully richer.
- **Cons:** Introduces duration-based cost, async processing pressure, format handling, and longer-running failure modes.
- **Context:** The current plan explicitly defers audio/video understanding to a later version. This work should reuse the same file attachment, provenance, and retrieval surfaces once transcript text exists.
- **Depends on / blocked by:** v0.5 file pipeline first, then a transcript-specific processing design.
