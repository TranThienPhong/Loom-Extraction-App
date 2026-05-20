/**
 * Postgres pool + helpers for the Shareable Editor Review feature.
 * Backed by DATABASE_URL_2 (Supabase #2) — kept separate from the existing
 * reference DB (clients/projects/areas/users) which lives on DATABASE_URL.
 */

import { Pool, PoolClient } from 'pg'

let pool: Pool | null = null

export function getReviewPool(): Pool {
  if (!pool) {
    const cs = process.env.DATABASE_URL_2
    if (!cs) {
      throw new Error('DATABASE_URL_2 is not set — cannot connect to review database')
    }
    pool = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  }
  return pool
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getReviewPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

export type ReviewStatus =
  | 'not_started'
  | 'in_progress'
  | 'blocked'
  | 'needs_review'
  | 'completed'

export const REVIEW_STATUSES: ReviewStatus[] = [
  'not_started', 'in_progress', 'blocked', 'needs_review', 'completed',
]

/** URL-safe random share id (~10 chars). */
export function generateShareId(length = 10): string {
  const chars = 'abcdefghijkmnopqrstuvwxyz23456789' // no 0/1/l for readability
  let out = ''
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}
