/**
 * Fetches reference data from the Supabase database so the AI prompt
 * can match project/client/area/assignee names to real records.
 */

export interface DBContext {
  clients: string[]
  projects: string[]    // "Project Name (Client Name)" format
  areas: string[]
  users: string[]
}

let cached: DBContext | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function getDBContext(): Promise<DBContext> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) return cached

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.warn('[DB] DATABASE_URL not set — skipping DB context')
    return { clients: [], projects: [], areas: [], users: [] }
  }

  try {
    // Dynamic import so pg is only loaded server-side
    const { Pool } = await import('pg')
    const pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
    })

    const [clientsRes, projectsRes, areasRes, usersRes] = await Promise.all([
      pool.query<{ name: string }>(`SELECT name FROM "Client" WHERE active = true ORDER BY name`),
      pool.query<{ name: string; client: string | null }>(`
        SELECT p.name, c.name AS client
        FROM "Project" p
        LEFT JOIN "Client" c ON c.id = p."clientId"
        ORDER BY p.name
      `),
      pool.query<{ name: string }>(`SELECT name FROM "Area" ORDER BY name`),
      pool.query<{ name: string }>(`SELECT name FROM "User" ORDER BY name`),
    ])

    await pool.end()

    const clients = clientsRes.rows.map(r => r.name)
    const projects = projectsRes.rows.map(r =>
      r.client ? `${r.name} (${r.client})` : r.name
    )
    const areas = areasRes.rows.map(r => r.name)
    const users = usersRes.rows.map(r => r.name)

    cached = { clients, projects, areas, users }
    cacheTime = Date.now()

    console.log(`[DB] Loaded context — ${clients.length} clients, ${projects.length} projects, ${areas.length} areas, ${users.length} users`)
    return cached
  } catch (err: any) {
    console.error('[DB] Failed to load DB context:', err.message)
    return { clients: [], projects: [], areas: [], users: [] }
  }
}

/** Format DB context as a compact string for injection into the AI prompt */
export function formatDBContextForPrompt(ctx: DBContext): string {
  if (!ctx.clients.length && !ctx.projects.length && !ctx.areas.length && !ctx.users.length) {
    return ''
  }
  const lines: string[] = [
    '--- REFERENCE DATABASE ---',
    'Use this to fill any field not explicitly mentioned in the transcript.',
    'Pick the most contextually fitting option from the lists below.',
  ]
  if (ctx.clients.length) lines.push(`CLIENTS: ${ctx.clients.join(', ')}`)
  if (ctx.projects.length) lines.push(`PROJECTS: ${ctx.projects.join(' | ')}`)
  if (ctx.areas.length) lines.push(`AREAS: ${ctx.areas.join(', ')}`)
  if (ctx.users.length) lines.push(`USERS: ${ctx.users.join(', ')}`)
  lines.push('--- END REFERENCE DATABASE ---')
  return lines.join('\n')
}
