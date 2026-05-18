import { NextRequest, NextResponse } from 'next/server'
import {
  getReviewSession,
  updateNoteCompletion,
  updateNoteText,
  deleteNoteFromSession,
} from '@/lib/reviewDb'

export const maxDuration = 30

/** GET /api/review-sessions/[id] */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!process.env.DATABASE_URL_2) {
      return NextResponse.json({ error: 'DATABASE_URL_2 not configured' }, { status: 503 })
    }
    const session = await getReviewSession(params.id)
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    return NextResponse.json(session)
  } catch (err: any) {
    console.error('[ReviewSession] GET error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * PATCH /api/review-sessions/[id]
 *
 * op: 'complete'   — { noteId, noteType, completed }
 * op: 'edit'       — { noteId, noteType, note }
 * op: 'delete'     — { noteId, noteType }
 * (no op)          — legacy: treated as 'complete'
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!process.env.DATABASE_URL_2) {
      return NextResponse.json({ error: 'DATABASE_URL_2 not configured' }, { status: 503 })
    }

    const body = await request.json()
    const op: string = body.op ?? 'complete'
    const noteType: 'global' | 'revision' = body.noteType === 'global' ? 'global' : 'revision'

    if (!body.noteId) {
      return NextResponse.json({ error: 'noteId is required' }, { status: 400 })
    }

    switch (op) {
      case 'complete':
        await updateNoteCompletion(id, body.noteId, noteType, !!body.completed)
        break
      case 'edit':
        if (body.note === undefined) return NextResponse.json({ error: 'note is required' }, { status: 400 })
        await updateNoteText(id, body.noteId, body.note, noteType)
        break
      case 'delete':
        await deleteNoteFromSession(id, body.noteId, noteType)
        break
      default:
        return NextResponse.json({ error: `Unknown op: ${op}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[ReviewSession] PATCH error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
