import { NextResponse } from 'next/server'
import { listExtractionResults } from '@/lib/resultsDb'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const results = await listExtractionResults(100)
    return NextResponse.json({ results })
  } catch (err: any) {
    console.error('[api/results] error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to list results' },
      { status: 500 },
    )
  }
}
