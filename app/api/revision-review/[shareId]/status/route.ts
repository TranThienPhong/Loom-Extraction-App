import { NextRequest, NextResponse } from 'next/server'
import { getReviewPool, REVIEW_STATUSES, ReviewStatus } from '@/lib/reviewDb'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ shareId: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { shareId } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const { itemType, itemId, status, userName } = body || {}

    if (itemType !== 'global' && itemType !== 'timed') {
      return NextResponse.json({ error: 'itemType must be global|timed' }, { status: 400 })
    }
    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
    }
    if (!REVIEW_STATUSES.includes(status as ReviewStatus)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }

    const db = getReviewPool()
    const sessionRes = await db.query<{ id: string }>(
      `SELECT id FROM review_sessions WHERE share_id = $1`, [shareId],
    )
    if (sessionRes.rowCount === 0) {
      return NextResponse.json({ error: 'Review session not found' }, { status: 404 })
    }
    const sessionId = sessionRes.rows[0].id

    const table = itemType === 'global' ? 'review_global_notes' : 'review_timed_notes'
    const result = await db.query(
      `UPDATE ${table}
          SET status = $1,
              status_updated_at = NOW(),
              status_updated_by = $2
        WHERE id = $3 AND session_id = $4
        RETURNING id, status, status_updated_at, status_updated_by`,
      [status, userName?.trim() || null, itemId, sessionId],
    )
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'item not found in this session' }, { status: 404 })
    }

    await db.query(`UPDATE review_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId])

    return NextResponse.json({ ok: true, item: result.rows[0] })
  } catch (err: any) {
    console.error('[review-status] error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to update status' },
      { status: 500 },
    )
  }
}
