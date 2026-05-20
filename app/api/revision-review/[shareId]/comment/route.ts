import { NextRequest, NextResponse } from 'next/server'
import { getReviewPool } from '@/lib/reviewDb'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ shareId: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { shareId } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const { itemType, itemId, userName, comment } = body || {}

    if (itemType !== 'global' && itemType !== 'timed') {
      return NextResponse.json({ error: 'itemType must be global|timed' }, { status: 400 })
    }
    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
    }
    const text = typeof comment === 'string' ? comment.trim() : ''
    if (!text) {
      return NextResponse.json({ error: 'comment cannot be empty' }, { status: 400 })
    }
    const who = typeof userName === 'string' && userName.trim() ? userName.trim() : 'Anonymous'

    const db = getReviewPool()
    const sessionRes = await db.query<{ id: string }>(
      `SELECT id FROM review_sessions WHERE share_id = $1`, [shareId],
    )
    if (sessionRes.rowCount === 0) {
      return NextResponse.json({ error: 'Review session not found' }, { status: 404 })
    }
    const sessionId = sessionRes.rows[0].id

    // Confirm the item belongs to this session (prevents cross-session writes).
    const table = itemType === 'global' ? 'review_global_notes' : 'review_timed_notes'
    const itemRes = await db.query(
      `SELECT 1 FROM ${table} WHERE id = $1 AND session_id = $2`,
      [itemId, sessionId],
    )
    if (itemRes.rowCount === 0) {
      return NextResponse.json({ error: 'item not found in this session' }, { status: 404 })
    }

    const insertRes = await db.query(
      `INSERT INTO review_comments (session_id, item_type, item_id, user_name, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, item_type, item_id, user_name, comment, created_at`,
      [sessionId, itemType, itemId, who, text],
    )
    await db.query(`UPDATE review_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId])

    return NextResponse.json({ ok: true, comment: insertRes.rows[0] })
  } catch (err: any) {
    console.error('[review-comment] error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to add comment' },
      { status: 500 },
    )
  }
}
