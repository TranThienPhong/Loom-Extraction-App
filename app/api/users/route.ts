import { NextResponse } from 'next/server'
import { getDBContext } from '@/lib/dbContext'

export const dynamic = 'force-dynamic'

/**
 * Returns active users from the reference DB (DATABASE_URL) — same source the
 * Task mode uses for assignee matching. Used to populate owner / editor / name
 * dropdowns in the manager share modal and the editor review page.
 */
export async function GET() {
  try {
    const ctx = await getDBContext()
    return NextResponse.json({ users: ctx.users })
  } catch (err: any) {
    console.error('[api/users] error:', err)
    return NextResponse.json({ users: [], error: err.message }, { status: 500 })
  }
}
