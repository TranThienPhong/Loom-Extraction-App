import { NextRequest, NextResponse } from 'next/server'
import { getReviewPool, generateShareId, withTransaction } from '@/lib/reviewDb'

export const maxDuration = 300

interface IncomingScreenshot {
  timestamp_seconds?: number
  timestamp_label?: string
  image_url?: string
  image_base64?: string
}

interface IncomingGlobalNote {
  note: string
  assigned_to?: string
}

interface IncomingTimedNote {
  title?: string
  note: string
  raw_speech?: string
  timestamp_seconds: number
  timestamp_label: string
  referenced_timestamp_seconds?: number | null
  referenced_timestamp_label?: string | null
  loom_url?: string
  assigned_to?: string
  screenshots?: IncomingScreenshot[]
}

interface CreateBody {
  title: string
  summary?: string
  videoId?: string
  loomUrl?: string
  ownerName?: string
  assignedTo?: string
  globalNotes?: IncomingGlobalNote[]
  timedNotes?: IncomingTimedNote[]
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBody
    if (!body?.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const shareId = generateShareId(10)

    await withTransaction(async (client) => {
      const sessionRes = await client.query<{ id: string }>(
        `INSERT INTO review_sessions (share_id, title, summary, video_id, loom_url, owner_name, assigned_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          shareId,
          body.title,
          body.summary || null,
          body.videoId || null,
          body.loomUrl || null,
          body.ownerName || null,
          body.assignedTo || null,
        ],
      )
      const sessionId = sessionRes.rows[0].id

      const globals = body.globalNotes || []
      for (let i = 0; i < globals.length; i++) {
        const g = globals[i]
        await client.query(
          `INSERT INTO review_global_notes (session_id, position, note, assigned_to)
           VALUES ($1, $2, $3, $4)`,
          [sessionId, i, g.note, g.assigned_to || null],
        )
      }

      const timed = body.timedNotes || []
      for (let i = 0; i < timed.length; i++) {
        const t = timed[i]
        const noteRes = await client.query<{ id: string }>(
          `INSERT INTO review_timed_notes
            (session_id, position, title, note, raw_speech,
             timestamp_seconds, timestamp_label,
             referenced_timestamp_seconds, referenced_timestamp_label,
             loom_url, assigned_to)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id`,
          [
            sessionId,
            i,
            t.title || null,
            t.note,
            t.raw_speech || null,
            Math.max(0, Math.floor(t.timestamp_seconds || 0)),
            t.timestamp_label || '0:00',
            t.referenced_timestamp_seconds ?? null,
            t.referenced_timestamp_label ?? null,
            t.loom_url || null,
            t.assigned_to || null,
          ],
        )
        const timedId = noteRes.rows[0].id

        const shots = t.screenshots || []
        for (let s = 0; s < shots.length; s++) {
          const shot = shots[s]
          await client.query(
            `INSERT INTO review_screenshots
              (timed_note_id, position, timestamp_seconds, timestamp_label, image_data, image_url)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              timedId,
              s,
              Math.max(0, Math.floor(shot.timestamp_seconds ?? t.timestamp_seconds ?? 0)),
              shot.timestamp_label || t.timestamp_label || '0:00',
              shot.image_base64 || null,
              shot.image_url || null,
            ],
          )
        }
      }
    })

    return NextResponse.json({ shareId })
  } catch (err: any) {
    console.error('[review-create] error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to create review session' },
      { status: 500 },
    )
  }
}

// Sanity GET so the route is browsable while iterating
export async function GET() {
  try {
    await getReviewPool().query('SELECT 1')
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
