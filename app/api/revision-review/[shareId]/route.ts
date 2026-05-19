import { NextRequest, NextResponse } from 'next/server'
import { getReviewPool } from '@/lib/reviewDb'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ shareId: string }>
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { shareId } = await ctx.params
    if (!shareId) {
      return NextResponse.json({ error: 'shareId required' }, { status: 400 })
    }

    const db = getReviewPool()
    const sessionRes = await db.query(
      `SELECT id, share_id, title, summary, video_id, loom_url, owner_name, assigned_to, created_at, updated_at
         FROM review_sessions
         WHERE share_id = $1`,
      [shareId],
    )
    if (sessionRes.rowCount === 0) {
      return NextResponse.json({ error: 'Review session not found' }, { status: 404 })
    }
    const session = sessionRes.rows[0]

    const [globalsRes, timedRes, commentsRes] = await Promise.all([
      db.query(
        `SELECT id, position, note, assigned_to, status, status_updated_at, status_updated_by
           FROM review_global_notes
           WHERE session_id = $1
           ORDER BY position ASC`,
        [session.id],
      ),
      db.query(
        `SELECT id, position, title, note, raw_speech,
                timestamp_seconds, timestamp_label,
                referenced_timestamp_seconds, referenced_timestamp_label,
                loom_url, assigned_to, status, status_updated_at, status_updated_by
           FROM review_timed_notes
           WHERE session_id = $1
           ORDER BY position ASC`,
        [session.id],
      ),
      db.query(
        `SELECT id, item_type, item_id, user_name, comment, created_at
           FROM review_comments
           WHERE session_id = $1
           ORDER BY created_at ASC`,
        [session.id],
      ),
    ])

    const timedIds = timedRes.rows.map((r: any) => r.id)
    let shotsRes = { rows: [] as any[] }
    if (timedIds.length > 0) {
      shotsRes = await db.query(
        `SELECT id, timed_note_id, position, timestamp_seconds, timestamp_label, image_data, image_url
           FROM review_screenshots
           WHERE timed_note_id = ANY($1::uuid[])
           ORDER BY position ASC`,
        [timedIds],
      )
    }

    const shotsByNote = new Map<string, any[]>()
    for (const s of shotsRes.rows) {
      const arr = shotsByNote.get(s.timed_note_id) || []
      arr.push({
        id: s.id,
        position: s.position,
        timestamp_seconds: s.timestamp_seconds,
        timestamp_label: s.timestamp_label,
        image_data: s.image_data,
        image_url: s.image_url,
      })
      shotsByNote.set(s.timed_note_id, arr)
    }

    return NextResponse.json({
      session,
      global_notes: globalsRes.rows,
      timed_notes: timedRes.rows.map((n: any) => ({
        ...n,
        screenshots: shotsByNote.get(n.id) || [],
      })),
      comments: commentsRes.rows,
    })
  } catch (err: any) {
    console.error('[review-get] error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to load review session' },
      { status: 500 },
    )
  }
}
