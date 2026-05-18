import { NextRequest, NextResponse } from 'next/server'
import {
  getTaskSession,
  updateTaskCompletion,
  updateTaskFields,
  deleteTaskFromSession,
  updateTaskSessionSummary,
} from '@/lib/reviewDb'

export const maxDuration = 30

/** GET /api/task-sessions/[id] */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!process.env.DATABASE_URL_2) {
      return NextResponse.json({ error: 'DATABASE_URL_2 not configured' }, { status: 503 })
    }
    const session = await getTaskSession(id)
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    return NextResponse.json(session)
  } catch (err: any) {
    console.error('[TaskSession] GET error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * PATCH /api/task-sessions/[id]
 *
 * op: 'complete'  — { taskId, completed }
 * op: 'edit'      — { taskId, task_name?, task_description? }
 * op: 'delete'    — { taskId }
 * op: 'type'      — { taskId, task_type }
 * op: 'summary'   — { summary }
 * (no op)         — legacy: { taskId, completed } treated as 'complete'
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

    switch (op) {
      case 'complete': {
        if (!body.taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
        await updateTaskCompletion(id, body.taskId, !!body.completed)
        break
      }
      case 'edit': {
        if (!body.taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
        const fields: Record<string, string> = {}
        if (body.task_name !== undefined) fields.task_name = body.task_name
        if (body.task_description !== undefined) fields.task_description = body.task_description
        if (Object.keys(fields).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
        await updateTaskFields(id, body.taskId, fields)
        break
      }
      case 'delete': {
        if (!body.taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
        await deleteTaskFromSession(id, body.taskId)
        break
      }
      case 'type': {
        if (!body.taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
        await updateTaskFields(id, body.taskId, { task_type: body.task_type ?? 'Nice-to-have' })
        break
      }
      case 'summary': {
        await updateTaskSessionSummary(id, body.summary ?? '')
        break
      }
      default:
        return NextResponse.json({ error: `Unknown op: ${op}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[TaskSession] PATCH error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
