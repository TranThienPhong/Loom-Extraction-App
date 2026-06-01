-- Allow a single PDF-source extraction to span multiple uploaded PDFs.
-- Mirrors the loom_urls/video_ids array columns added for multi-Loom sessions:
-- the existing singular fields stay aligned with the first PDF for back-compat,
-- and this array carries every uploaded filename in the order they were added.
-- Used by the history list to show how many PDFs a session spans.

ALTER TABLE extraction_results
  ADD COLUMN IF NOT EXISTS pdf_file_names TEXT[];
