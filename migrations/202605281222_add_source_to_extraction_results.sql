-- Track which input format produced each extraction: a Loom video vs. a PDF
-- upload. The task payload schema is identical for both, so we only need to
-- distinguish them for filtering/UI purposes.

ALTER TABLE extraction_results
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'loom'
    CHECK (source IN ('loom', 'pdf'));
