-- Allow a single extraction to span multiple Loom videos.
-- The existing loom_url / video_id columns are kept (they store the *first* URL
-- for back-compat with the history-list query). The new array columns carry
-- every URL/ID in the order they were submitted.

ALTER TABLE extraction_results
  ADD COLUMN IF NOT EXISTS loom_urls TEXT[],
  ADD COLUMN IF NOT EXISTS video_ids TEXT[];
