import { NextRequest, NextResponse } from 'next/server'
import { getExtractionResult, deleteExtractionResult } from '@/lib/resultsDb'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const row = await getExtractionResult(id)
    if (!row) return NextResponse.json({ error: 'Result not found' }, { status: 404 })
    return NextResponse.json(row)
  } catch (err: any) {
    console.error('[api/results/[id]] error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to load result' },
      { status: 500 },
    )
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const ok = await deleteExtractionResult(id)
    if (!ok) return NextResponse.json({ error: 'Result not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[api/results/[id] DELETE] error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to delete result' },
      { status: 500 },
    )
  }
}
