/**
 * DB2 — Supabase pool for persisting shareable review sessions.
 * Completely separate from DB1 (DATABASE_URL) used for task-mode context.
 * NEVER touches DATABASE_URL.
 */

import { Pool } from 'pg'

let pool2: Pool | null = null

export function getReviewPool(): Pool {
  if (!pool2) {
    pool2 = new Pool({
      connectionString: process.env.DATABASE_URL_2,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 5000,
    })
  }
  return pool2
}

/** Run once to create the table if it doesn't exist */
export async function ensureReviewTable(): Promise<void> {
  const db = getReviewPool()
  await db.query(`
    CREATE TABLE IF NOT EXISTS review_sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT '',
      summary     TEXT NOT NULL DEFAULT '',
      loom_url    TEXT NOT NULL DEFAULT '',
      video_id    TEXT NOT NULL DEFAULT '',
      global_notes  JSONB NOT NULL DEFAULT '[]',
      revision_notes JSONB NOT NULL DEFAULT '[]',
      transcript  JSONB NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

export interface ReviewSession {
  id: string
  title: string
  summary: string
  loom_url: string
  video_id: string
  global_notes: any[]
  revision_notes: any[]
  transcript: any[]
  created_at: string
  updated_at: string
}

export async function createReviewSession(data: Omit<ReviewSession, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
  await ensureReviewTable()
  const db = getReviewPool()
  // 8-char alphanumeric ID
  const id = Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6)
  await db.query(
    `INSERT INTO review_sessions (id, title, summary, loom_url, video_id, global_notes, revision_notes, transcript)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, data.title, data.summary, data.loom_url, data.video_id,
     JSON.stringify(data.global_notes), JSON.stringify(data.revision_notes), JSON.stringify(data.transcript)]
  )
  return id
}

export async function getReviewSession(id: string): Promise<ReviewSession | null> {
  await ensureReviewTable()
  const db = getReviewPool()
  const res = await db.query<ReviewSession>(
    `SELECT * FROM review_sessions WHERE id = $1`, [id]
  )
  return res.rows[0] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK SESSIONS (task-mode shareable review)
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskItem {
  _id: string
  task_name: string
  task_description: string
  loom_url: string
  timestamp_seconds: number
  timestamp_label: string
  priority?: number
  complexity?: string
  project?: string
  client?: string
  area?: string
  assignee?: string
  task_type?: string
  completed: boolean
  image_url?: string
  image_base64?: string
  screenshots?: Array<{
    timestamp_seconds: number
    timestamp_label: string
    image_url: string
    image_base64?: string
  }>
}

export interface TaskSession {
  id: string
  title: string
  summary: string
  loom_url: string
  video_id: string
  tasks: TaskItem[]
  transcript: { t: string; s: string }[]
  created_at: string
  updated_at: string
}

export async function ensureTaskTable(): Promise<void> {
  const db = getReviewPool()
  await db.query(`
    CREATE TABLE IF NOT EXISTS task_sessions (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      summary    TEXT NOT NULL DEFAULT '',
      loom_url   TEXT NOT NULL DEFAULT '',
      video_id   TEXT NOT NULL DEFAULT '',
      tasks      JSONB NOT NULL DEFAULT '[]',
      transcript JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

export async function createTaskSession(
  data: Omit<TaskSession, 'id' | 'created_at' | 'updated_at'>
): Promise<string> {
  await ensureTaskTable()
  const db = getReviewPool()
  const id = Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6)
  await db.query(
    `INSERT INTO task_sessions (id, title, summary, loom_url, video_id, tasks, transcript)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, data.title, data.summary, data.loom_url, data.video_id,
     JSON.stringify(data.tasks), JSON.stringify(data.transcript)]
  )
  return id
}

export async function getTaskSession(id: string): Promise<TaskSession | null> {
  await ensureTaskTable()
  const db = getReviewPool()
  const res = await db.query<TaskSession>(`SELECT * FROM task_sessions WHERE id = $1`, [id])
  return res.rows[0] ?? null
}

export async function updateTaskCompletion(
  sessionId: string,
  taskId: string,
  completed: boolean
): Promise<void> {
  await ensureTaskTable()
  const db = getReviewPool()
  await db.query(
    `UPDATE task_sessions
     SET tasks = (
       SELECT jsonb_agg(
         CASE WHEN (elem->>'_id') = $2
           THEN jsonb_set(elem, '{completed}', $3::jsonb)
           ELSE elem
         END
       )
       FROM jsonb_array_elements(tasks) AS elem
     ),
     updated_at = now()
     WHERE id = $1`,
    [sessionId, taskId, JSON.stringify(completed)]
  )
}

export async function updateTaskFields(
  sessionId: string,
  taskId: string,
  fields: { task_name?: string; task_description?: string; task_type?: string }
): Promise<void> {
  await ensureTaskTable()
  const db = getReviewPool()
  // Merge fields into the matching element using the || operator
  await db.query(
    `UPDATE task_sessions
     SET tasks = (
       SELECT jsonb_agg(
         CASE WHEN (elem->>'_id') = $2
           THEN elem || $3::jsonb
           ELSE elem
         END
       )
       FROM jsonb_array_elements(tasks) AS elem
     ),
     updated_at = now()
     WHERE id = $1`,
    [sessionId, taskId, JSON.stringify(fields)]
  )
}

export async function deleteTaskFromSession(
  sessionId: string,
  taskId: string
): Promise<void> {
  await ensureTaskTable()
  const db = getReviewPool()
  await db.query(
    `UPDATE task_sessions
     SET tasks = (
       SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
       FROM jsonb_array_elements(tasks) AS elem
       WHERE (elem->>'_id') != $2
     ),
     updated_at = now()
     WHERE id = $1`,
    [sessionId, taskId]
  )
}

export async function updateTaskSessionSummary(
  sessionId: string,
  summary: string
): Promise<void> {
  await ensureTaskTable()
  const db = getReviewPool()
  await db.query(
    `UPDATE task_sessions SET summary = $2, updated_at = now() WHERE id = $1`,
    [sessionId, summary]
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW SESSION note completion (existing)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateNoteCompletion(
  sessionId: string,
  noteId: string,
  noteType: 'global' | 'revision',
  completed: boolean
): Promise<void> {
  await ensureReviewTable()
  const db = getReviewPool()
  const col = noteType === 'global' ? 'global_notes' : 'revision_notes'
  await db.query(
    `UPDATE review_sessions
     SET ${col} = (
       SELECT jsonb_agg(
         CASE WHEN (elem->>'id') = $2
           THEN jsonb_set(elem, '{completed}', $3::jsonb)
           ELSE elem
         END
       )
       FROM jsonb_array_elements(${col}) AS elem
     ),
     updated_at = now()
     WHERE id = $1`,
    [sessionId, noteId, JSON.stringify(completed)]
  )
}

export async function updateNoteText(
  sessionId: string,
  noteId: string,
  noteText: string,
  noteType: 'global' | 'revision'
): Promise<void> {
  await ensureReviewTable()
  const db = getReviewPool()
  const col = noteType === 'global' ? 'global_notes' : 'revision_notes'
  await db.query(
    `UPDATE review_sessions
     SET ${col} = (
       SELECT jsonb_agg(
         CASE WHEN (elem->>'id') = $2
           THEN jsonb_set(elem, '{note}', $3::jsonb)
           ELSE elem
         END
       )
       FROM jsonb_array_elements(${col}) AS elem
     ),
     updated_at = now()
     WHERE id = $1`,
    [sessionId, noteId, JSON.stringify(noteText)]
  )
}

export async function deleteNoteFromSession(
  sessionId: string,
  noteId: string,
  noteType: 'global' | 'revision'
): Promise<void> {
  await ensureReviewTable()
  const db = getReviewPool()
  const col = noteType === 'global' ? 'global_notes' : 'revision_notes'
  await db.query(
    `UPDATE review_sessions
     SET ${col} = (
       SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
       FROM jsonb_array_elements(${col}) AS elem
       WHERE (elem->>'id') != $2
     ),
     updated_at = now()
     WHERE id = $1`,
    [sessionId, noteId]
  )
}
