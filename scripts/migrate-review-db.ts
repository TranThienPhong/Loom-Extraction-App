/**
 * Migration runner for the Shareable Editor Review database (DATABASE_URL_2).
 *
 * Usage:
 *   npx tsx scripts/migrate-review-db.ts
 *
 * Reads all *.sql files in /migrations/, applies any not yet recorded in
 * the schema_migrations table, in ascending filename order.
 */

import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

async function loadDotEnv() {
  // Minimal .env.local loader — avoids adding a dotenv dep.
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

async function main() {
  await loadDotEnv()

  const cs = process.env.DIRECT_URL_2 || process.env.DATABASE_URL_2
  if (!cs) {
    console.error('❌ DIRECT_URL_2 (or DATABASE_URL_2) is not set in .env.local')
    process.exit(1)
  }

  const migrationsDir = path.join(process.cwd(), 'migrations')
  if (!fs.existsSync(migrationsDir)) {
    console.error(`❌ Migrations directory not found: ${migrationsDir}`)
    process.exit(1)
  }
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
  if (files.length === 0) {
    console.log('No migrations to run.')
    return
  }

  const client = new Client({
    connectionString: cs,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    // Ensure tracking table exists (first migration also creates it, but make
    // this runner safe before the table exists).
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const { rows } = await client.query<{ filename: string }>(`SELECT filename FROM schema_migrations`)
    const applied = new Set(rows.map(r => r.filename))

    let count = 0
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`✓ ${file}  (already applied)`)
        continue
      }
      console.log(`→ applying ${file} ...`)
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(`INSERT INTO schema_migrations(filename) VALUES ($1)`, [file])
        await client.query('COMMIT')
        count++
        console.log(`✓ ${file}  (applied)`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    console.log(`\nDone. Applied ${count} new migration${count === 1 ? '' : 's'}.`)
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
