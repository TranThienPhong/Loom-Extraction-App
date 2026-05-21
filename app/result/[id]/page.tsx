'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

/**
 * Universal entry point for a stored extraction result. Fetches the row from
 * /api/results/[id], hydrates IndexedDB / sessionStorage so the existing
 * /results and /revision pages can read it as if it had just been processed,
 * and redirects to the mode-appropriate page.
 */
export default function ResultLoaderPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'task' | 'revision' | null>(null)

  useEffect(() => {
    const id = params?.id
    if (!id) return
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(`/api/results/${id}`, { cache: 'no-store' })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `HTTP ${res.status}`)
        }
        const row = await res.json()
        if (cancelled) return
        setMode(row.mode)
        const payload = row.payload || {}

        if (row.mode === 'task') {
          const { storeProcessingResults } = await import('@/lib/imageStorage')
          await storeProcessingResults(payload)
          try {
            sessionStorage.setItem('loomResults_videoId', payload.videoId || '')
            sessionStorage.setItem('loomResults', JSON.stringify(payload))
          } catch {}
          router.replace('/results')
        } else if (row.mode === 'revision') {
          const { storeRevisionResults } = await import('@/lib/imageStorage')
          await storeRevisionResults(payload)
          try {
            sessionStorage.setItem('revisionResults', JSON.stringify(payload))
          } catch {}
          router.replace('/revision')
        } else {
          throw new Error(`Unknown mode: ${row.mode}`)
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load result')
      }
    })()

    return () => { cancelled = true }
  }, [params?.id, router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white border-2 border-red-300 p-6 max-w-md text-center">
          <p className="text-red-700 font-semibold mb-2">Couldn&apos;t load result</p>
          <p className="text-gray-600 text-sm mb-4">{error}</p>
          <button onClick={() => router.replace('/')}
            className="px-4 py-2 text-sm font-semibold border-2 border-gray-300 bg-white text-gray-800 hover:bg-gray-100">
            ← Back to home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-gray-600 text-lg">
          Loading {mode === 'revision' ? 'revision notes' : mode === 'task' ? 'task list' : 'result'}…
        </p>
      </div>
    </div>
  )
}
