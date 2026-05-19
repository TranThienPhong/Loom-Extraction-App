-- Shareable Editor Review (revision tracking) — initial schema.
-- Runs against DATABASE_URL_2 / DIRECT_URL_2 (separate Supabase project).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Sessions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id          TEXT UNIQUE NOT NULL,
  title             TEXT NOT NULL,
  summary           TEXT,
  video_id          TEXT,
  loom_url          TEXT,
  owner_name        TEXT,
  assigned_to       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Global notes (apply to whole video) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS review_global_notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  note              TEXT NOT NULL,
  assigned_to       TEXT,
  status            TEXT NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started','in_progress','blocked','needs_review','completed')),
  status_updated_at TIMESTAMPTZ,
  status_updated_by TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_global_notes_session
  ON review_global_notes(session_id, position);

-- ── Timed (timestamped) revision notes ───────────────────────────────────
CREATE TABLE IF NOT EXISTS review_timed_notes (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                    UUID NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  position                      INTEGER NOT NULL,
  title                         TEXT,
  note                          TEXT NOT NULL,
  raw_speech                    TEXT,
  timestamp_seconds             INTEGER NOT NULL,
  timestamp_label               TEXT NOT NULL,
  referenced_timestamp_seconds  INTEGER,
  referenced_timestamp_label    TEXT,
  loom_url                      TEXT,
  assigned_to                   TEXT,
  status            TEXT NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started','in_progress','blocked','needs_review','completed')),
  status_updated_at TIMESTAMPTZ,
  status_updated_by TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_timed_notes_session
  ON review_timed_notes(session_id, position);

-- ── Screenshots tied to timed notes ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_screenshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timed_note_id     UUID NOT NULL REFERENCES review_timed_notes(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  timestamp_seconds INTEGER NOT NULL,
  timestamp_label   TEXT NOT NULL,
  image_data        TEXT,  -- data URI (base64) — persisted for shareability
  image_url         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_screenshots_note
  ON review_screenshots(timed_note_id, position);

-- ── Comments (per-user threads on any item) ──────────────────────────────
CREATE TABLE IF NOT EXISTS review_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  item_type     TEXT NOT NULL CHECK (item_type IN ('global','timed')),
  item_id       UUID NOT NULL,
  user_name     TEXT NOT NULL,
  comment       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_comments_item
  ON review_comments(session_id, item_type, item_id, created_at);

-- ── Track applied migrations so the runner is idempotent ─────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
