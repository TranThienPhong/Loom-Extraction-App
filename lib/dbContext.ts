/**
 * Fetches reference names from the Supabase database so the AI prompt
 * can match project/client/area/assignee to real records.
 * Fetched as the FIRST step of processing, before transcript analysis.
 */

import { Pool } from 'pg'

export interface DBContext {
  clients: string[]
  projects: string[]    // "Project Name (Client Name)" format
  areas: string[]
  users: string[]
}

let cached: DBContext | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    })
  }
  return pool
}

export async function getDBContext(): Promise<DBContext> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) {
    console.log('[DB] Using cached context')
    return cached
  }

  if (!process.env.DATABASE_URL) {
    console.warn('[DB] DATABASE_URL not set — skipping DB context')
    return { clients: [], projects: [], areas: [], users: [] }
  }

  try {
    const db = getPool()

    const [clientsRes, projectsRes, areasRes, usersRes] = await Promise.all([
      db.query<{ name: string }>(`SELECT name FROM "Client" WHERE active = true ORDER BY name`),
      db.query<{ name: string; client: string | null }>(`
        SELECT p.name, c.name AS client
        FROM "Project" p
        LEFT JOIN "Client" c ON c.id = p."clientId"
        WHERE p.active = true AND p."deletedAt" IS NULL
        ORDER BY p.name
      `),
      db.query<{ name: string }>(`SELECT name FROM "Area" ORDER BY name`),
      db.query<{ name: string }>(`SELECT name FROM "User" WHERE active = true ORDER BY name`),
    ])

    cached = {
      clients: clientsRes.rows.map(r => r.name),
      projects: projectsRes.rows.map(r => r.client ? `${r.name} (${r.client})` : r.name),
      areas: areasRes.rows.map(r => r.name),
      users: usersRes.rows.map(r => r.name),
    }
    cacheTime = Date.now()

    console.log(`[DB] Loaded: ${cached.clients.length} clients, ${cached.projects.length} projects, ${cached.areas.length} areas, ${cached.users.length} users`)
    return cached
  } catch (err: any) {
    console.error('[DB] Failed to load context:', err.message)
    return { clients: [], projects: [], areas: [], users: [] }
  }
}

/** Format DB context as compact text for the AI prompt */
export function formatDBContextForPrompt(ctx: DBContext): string {
  if (!ctx.clients.length && !ctx.projects.length && !ctx.areas.length && !ctx.users.length) {
    return ''
  }
  const lines: string[] = [
    '--- REFERENCE DATABASE (use to fill any field not found in transcript) ---',
  ]
  if (ctx.clients.length) lines.push(`CLIENTS: ${ctx.clients.join(', ')}`)
  if (ctx.projects.length) lines.push(`PROJECTS: ${ctx.projects.join(' | ')}`)
  if (ctx.areas.length) lines.push(`AREAS: ${ctx.areas.join(', ')}`)
  if (ctx.users.length) lines.push(`USERS: ${ctx.users.join(', ')}`)
  if (ctx.users.length) lines.push(
    'ASSIGNEE MATCHING: The transcript is auto-transcribed and names are often mispronounced or misspelled. ' +
    'Match any name in the transcript to the closest USERS entry by sound or spelling similarity. ' +
    'Examples: "Jonas", "Jaunas", "Yaunius" → Jaunius | "Foam", "Phone", "Fong", "Pong" → Phong | ' +
    'Always prefer a real USERS name over the raw transcript text.'
  )
  lines.push('--- END REFERENCE DATABASE ---')
  return lines.join('\n')
}
