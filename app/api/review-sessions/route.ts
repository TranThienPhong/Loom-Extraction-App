import { NextRequest, NextResponse } from 'next/server'
import { createReviewSession, getReviewSession } from '@/lib/reviewDb'

export const maxDuration = 30

/** POST /api/review-sessions — save a new session, return { id } */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, summary, loom_url, video_id, global_notes, revision_notes, transcript } = body

    if (!loom_url) {
      return NextResponse.json({ error: 'loom_url is required' }, { status: 400 })
    }
    if (!process.env.DATABASE_URL_2) {
      return NextResponse.json({ error: 'DATABASE_URL_2 not configured' }, { status: 503 })
    }

    // Strip ALL base64 blobs — shared pages use image_url (Loom CDN) instead
    const cleanNotes = (notes: any[]) =>
      (notes || []).map((n: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { image_base64, ...noteWithout } = n
        return {
          ...noteWithout,
          screenshots: (n.screenshots || []).map((s: any) => ({
            timestamp_seconds: s.timestamp_seconds,
            timestamp_label: s.timestamp_label,
            image_url: s.image_url || '',
          })),
        }
      })

    const id = await createReviewSession({
      title: title || '',
      summary: summary || '',
      loom_url,
      video_id: video_id || '',
      global_notes: global_notes || [],
      revision_notes: cleanNotes(revision_notes),
      transcript: transcript || [],
    })

    return NextResponse.json({ id })
  } catch (err: any) {
    console.error('[ReviewSession] POST error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** GET /api/review-sessions?id=xxx — load a session */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL_2) {
      return NextResponse.json({ error: 'DATABASE_URL_2 not configured' }, { status: 503 })
    }

    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const session = await getReviewSession(id)
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    return NextResponse.json(session)
  } catch (err: any) {
    console.error('[ReviewSession] GET error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
