/**
 * Extraction-results history (task + revision modes).
 * Lives on the same Postgres as the editor-review feature (DATABASE_URL_2),
 * reusing the pool from lib/reviewDb.ts.
 */

import { getReviewPool } from './reviewDb'

export type ExtractionMode = 'task' | 'revision'

export interface ExtractionResultSummary {
  id: string
  mode: ExtractionMode
  title: string | null
  summary: string | null
  video_id: string | null
  loom_url: string | null
  item_count: number
  created_at: string
}

export interface ExtractionResultFull extends ExtractionResultSummary {
  payload: any
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/**
 * `YYYYMMDD_HHMMSS_<rand4>` — sortable and unique. The HHMMSS slice doubles
 * as the human-readable timestamp shown in the history list.
 */
export function generateResultId(now = new Date()): string {
  const y = now.getFullYear()
  const mo = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const h = pad(now.getHours())
  const mi = pad(now.getMinutes())
  const s = pad(now.getSeconds())
  const rand = Math.random().toString(36).slice(2, 6)
  return `${y}${mo}${d}_${h}${mi}${s}_${rand}`
}

export async function saveExtractionResult(opts: {
  mode: ExtractionMode
  title?: string | null
  summary?: string | null
  videoId?: string | null
  loomUrl?: string | null
  itemCount?: number
  payload: any
}): Promise<{ id: string }> {
  const id = generateResultId()
  const db = getReviewPool()
  await db.query(
    `INSERT INTO extraction_results
       (id, mode, title, summary, video_id, loom_url, item_count, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      id,
      opts.mode,
      opts.title ?? null,
      opts.summary ?? null,
      opts.videoId ?? null,
      opts.loomUrl ?? null,
      opts.itemCount ?? 0,
      JSON.stringify(opts.payload),
    ],
  )
  return { id }
}

export async function listExtractionResults(limit = 50): Promise<ExtractionResultSummary[]> {
  const db = getReviewPool()
  const res = await db.query(
    `SELECT id, mode, title, summary, video_id, loom_url, item_count, created_at
       FROM extraction_results
       ORDER BY created_at DESC
       LIMIT $1`,
    [limit],
  )
  return res.rows as ExtractionResultSummary[]
}

export async function getExtractionResult(id: string): Promise<ExtractionResultFull | null> {
  const db = getReviewPool()
  const res = await db.query(
    `SELECT id, mode, title, summary, video_id, loom_url, item_count, payload, created_at
       FROM extraction_results
       WHERE id = $1`,
    [id],
  )
  if (res.rowCount === 0) return null
  return res.rows[0] as ExtractionResultFull
}

export async function deleteExtractionResult(id: string): Promise<boolean> {
  const db = getReviewPool()
  const res = await db.query(`DELETE FROM extraction_results WHERE id = $1`, [id])
  return (res.rowCount ?? 0) > 0
}
