-- Extraction results history — one row per Loom extraction (task or revision mode).
-- ID is a timestamp-based string (YYYYMMDD_HHMMSS_<rand>) so it is human-sortable
-- and can be displayed as `YYYYMMDD_results_HHMMSS` in the UI.

CREATE TABLE IF NOT EXISTS extraction_results (
  id          TEXT PRIMARY KEY,
  mode        TEXT NOT NULL CHECK (mode IN ('task','revision')),
  title       TEXT,
  summary     TEXT,
  video_id    TEXT,
  loom_url    TEXT,
  item_count  INTEGER NOT NULL DEFAULT 0,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_results_created_at
  ON extraction_results (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extraction_results_mode_created
  ON extraction_results (mode, created_at DESC);
