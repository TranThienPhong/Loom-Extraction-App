'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { storeProcessingResults, storeRevisionResults } from '@/lib/imageStorage'

interface HistoryItem {
  id: string
  mode: 'task' | 'revision'
  title: string | null
  summary: string | null
  video_id: string | null
  loom_url: string | null
  item_count: number
  created_at: string
}

function historyDisplayName(createdAt: string): string {
  const d = new Date(createdAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_results_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export default function Home() {
  // Multiple Loom URLs are kept in submit order — labeled Vid 1, Vid 2, ... in the UI.
  const [loomUrls, setLoomUrls] = useState<string[]>([''])
  const [transcript, setTranscript] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{message: string, needsManualTranscript?: boolean} | null>(null)
  const [useManualTranscript, setUseManualTranscript] = useState(false)
  const [mode, setMode] = useState<'task' | 'revision'>('task')
  // Task List mode supports two input sources: Loom videos or a PDF upload.
  // Revision Notes mode is Loom-only (per scope).
  const [taskSource, setTaskSource] = useState<'loom' | 'pdf'>('loom')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'task' | 'revision'>('all')
  const router = useRouter()

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await fetch('/api/results', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setHistory(Array.isArray(j.results) ? j.results : [])
    } catch (e: any) {
      setHistoryError(e.message || 'Failed to load history')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const deleteHistoryItem = async (id: string) => {
    if (!confirm('Delete this extraction from history?\nThis cannot be undone.')) return
    try {
      const res = await fetch(`/api/results/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      setHistory(prev => prev.filter(h => h.id !== id))
    } catch (e: any) {
      alert('Failed to delete: ' + e.message)
    }
  }

  // Auto-show manual transcript option when API fails
  useEffect(() => {
    if (error?.needsManualTranscript) {
      setUseManualTranscript(true)
    }
  }, [error])

  // Manual transcript only pairs with a single video — collapse extra slots if
  // the user enables it while they have multiple URLs queued.
  useEffect(() => {
    if (useManualTranscript && loomUrls.length > 1) {
      setLoomUrls(prev => [prev[0] ?? ''])
    }
  }, [useManualTranscript, loomUrls.length])

  const cleanedLoomUrls = loomUrls.map(u => u.trim()).filter(Boolean)
  // PDF source uses a different input affordance — hide the Loom URL controls.
  const isPdfSource = mode === 'task' && taskSource === 'pdf'
  // Revision Notes Mode does not yet support multiple videos — keep it single-URL.
  const canAddAnother = mode === 'task' && taskSource === 'loom' && !useManualTranscript

  const updateUrlAt = (i: number, value: string) =>
    setLoomUrls(prev => prev.map((u, idx) => (idx === i ? value : u)))
  const addUrlSlot = () => setLoomUrls(prev => [...prev, ''])
  const removeUrlAt = (i: number) =>
    setLoomUrls(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i))

  // Processing saves the result to the DB (history) BEFORE returning the big
  // JSON response. On a slow/corporate network that response can be cut after
  // the save — the client then throws even though the work is done (this is the
  // "error on my boss's end but it's in History" case). When that happens we
  // look up the freshly-saved row and route to /result/[id], which rebuilds the
  // result from the DB. Returns the recovered row id, or null if none matches.
  const findRecentResult = async (
    src: 'pdf' | 'loom',
    pdfName?: string,
  ): Promise<string | null> => {
    try {
      const res = await fetch('/api/results', { cache: 'no-store' })
      if (!res.ok) return null
      const { results } = await res.json()
      if (!Array.isArray(results)) return null
      // Rows come back newest-first. Only consider ones created in the last few
      // minutes so we never grab an unrelated older extraction.
      const cutoff = Date.now() - 6 * 60 * 1000
      const wantTitle = pdfName ? pdfName.replace(/\.pdf$/i, '').slice(0, 120) : null
      for (const r of results) {
        if (r.mode !== 'task' || r.source !== src) continue
        const created = new Date(r.created_at).getTime()
        if (Number.isFinite(created) && created < cutoff) continue
        // For PDFs we can match the exact upload by its filename-derived title,
        // which makes recovery safe even if several uploads happen close together.
        if (src === 'pdf' && wantTitle && r.title !== wantTitle) continue
        return r.id
      }
    } catch {
      // best-effort — fall through to the normal error UI
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (mode === 'revision') {
        // ── Revision Notes Mode ──────────────────────────────────────────
        const response = await fetch('/api/process-revision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loomUrl: cleanedLoomUrls[0] || '',
            manualTranscript: useManualTranscript ? transcript : null,
          }),
        })
        const data = await response.json()
        if (response.ok) {
          // Store in IndexedDB (survives sessionStorage quota limits)
          try {
            await storeRevisionResults(data)
            console.log('[App] ✅ Revision results stored in IndexedDB')
          } catch (idbErr) {
            console.warn('[App] IndexedDB revision store failed, falling back to sessionStorage:', idbErr)
            // Fallback: sessionStorage — strip base64 if too large
            try {
              sessionStorage.setItem('revisionResults', JSON.stringify(data))
            } catch {
              try {
                const slim = {
                  ...data,
                  revision_notes: data.revision_notes?.map((n: any) => ({
                    ...n,
                    screenshots: n.screenshots?.map((s: any) => ({ ...s, image_base64: undefined }))
                  }))
                }
                sessionStorage.setItem('revisionResults', JSON.stringify(slim))
              } catch {}
            }
          }
          await new Promise(resolve => setTimeout(resolve, 100))
          router.push('/revision')
        } else {
          setError({
            message: data.error || 'An error occurred while processing the video',
            needsManualTranscript: data.needsManualTranscript,
          })
          setLoading(false)
        }
        return
      }

      // ── Task List Mode ───────────────────────────────────────────────
      let response: Response
      if (taskSource === 'pdf') {
        if (!pdfFile) {
          setError({ message: 'Please choose a PDF file to upload' })
          setLoading(false)
          return
        }
        const form = new FormData()
        form.append('file', pdfFile)
        response = await fetch('/api/process-pdf', { method: 'POST', body: form })
      } else {
        response = await fetch('/api/process-loom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loomUrls: cleanedLoomUrls,
            manualTranscript: useManualTranscript ? transcript : null,
          }),
        })
      }

      const data = await response.json()
      
      if (response.ok) {
        console.log('[App] 📦 Received data with', data.tasks?.length, 'tasks')
        console.log('[App] Summary:', data.summary?.substring(0, 80))
        
        // Log first task to verify base64 exists
        if (data.tasks && data.tasks.length > 0) {
          const firstTask = data.tasks[0]
          console.log('[App] First task has image_base64:', !!firstTask.image_base64)
          console.log('[App] First task has screenshots:', firstTask.screenshots?.length || 0)
          if (firstTask.screenshots && firstTask.screenshots.length > 0) {
            console.log('[App] First screenshot has base64:', !!firstTask.screenshots[0].image_base64)
            console.log('[App] Base64 length:', firstTask.screenshots[0].image_base64?.length || 0)
          }
        }
        
        // DUAL STORAGE: Try both methods for maximum reliability
        let storageSuccess = false
        
        // Method 1: IndexedDB (best for Railway, 50MB+ quota)
        try {
          console.log('[App] 💾 Attempting IndexedDB storage...')
          await storeProcessingResults(data)
          console.log('[App] ✅ IndexedDB storage SUCCESS')
          storageSuccess = true
        } catch (indexedDBError) {
          console.error('[App] ❌ IndexedDB FAILED:', indexedDBError)
        }
        
        // Method 2: sessionStorage (backup for local dev)
        try {
          console.log('[App] 💾 Attempting sessionStorage...')
          sessionStorage.setItem('loomResults', JSON.stringify(data))
          if (data.id) sessionStorage.setItem('loomResults_extractionId', data.id)
          console.log('[App] ✅ sessionStorage SUCCESS')
          storageSuccess = true
        } catch (quotaError) {
          console.warn('[App] ⚠️ sessionStorage quota exceeded')  
          // Try without base64 as last resort
          try {
            const dataWithoutBase64 = {
              ...data,
              tasks: data.tasks.map((task: any) => ({
                ...task,
                image_base64: undefined,
                screenshots: task.screenshots?.map((screenshot: any) => ({
                  ...screenshot,
                  image_base64: undefined
                }))
              }))
            }
            sessionStorage.setItem('loomResults', JSON.stringify(dataWithoutBase64))
            console.log('[App] ⚠️ Stored without images in sessionStorage')
          } catch (e) {
            console.error('[App] ❌ sessionStorage complete failure')
          }
        }
        
        if (!storageSuccess) {
          alert('Warning: Failed to store images. They may not display correctly.')
        }
        
        // Small delay to ensure storage completes
        await new Promise(resolve => setTimeout(resolve, 100))
        router.push('/results')
      } else {
        setError({
          message: data.error || 'An error occurred while processing the video',
          needsManualTranscript: data.needsManualTranscript
        })
        setLoading(false)
      }
    } catch (error) {
      console.error(error)
      // The request failed on the client — most often a large response dropped
      // mid-transfer on a slow/corporate network. The server may have already
      // finished and saved the result to History before the connection broke.
      // Try to recover by routing to that saved row instead of dead-ending.
      if (mode === 'task') {
        const recoveredId = await findRecentResult(
          taskSource,
          taskSource === 'pdf' ? pdfFile?.name : undefined,
        )
        if (recoveredId) {
          router.push(`/result/${recoveredId}`)
          return
        }
      }
      setError({
        message:
          'The connection dropped before the result finished loading. If you uploaded a large file, check the History section below — the result may have completed there.',
      })
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block w-16 h-16 mb-4">
            <div className="w-full h-full border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">
            {mode === 'revision' ? 'Generating Revision Notes...' : 'Processing your Loom video...'}
          </h2>
          <p className="text-gray-600 mt-2">This may take a few minutes</p>

        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Loom Extraction App
          </h1>
          <p className="text-xl text-gray-600">
            Turn your Loom video feedback into structured outputs automatically
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-6 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-red-800">
                  {error.needsManualTranscript ? '⚠️ Auto-Extraction Failed' : 'Error Processing Video'}
                </h3>
                <div className="mt-2 text-sm text-red-700 whitespace-pre-wrap">
                  {error.message}
                </div>
                {error.needsManualTranscript && (
                  <div className="mt-4 p-3 bg-yellow-50 border-2 border-yellow-300 text-sm">
                    <p className="font-semibold text-yellow-900">💡 Solution: Use Manual Transcript</p>
                    <p className="text-yellow-800 mt-1">The automatic transcript extraction failed (Loom API may be blocked or unavailable). Please enable the "Use manual transcript" option below and paste your transcript manually.</p>
                  </div>
                )}
                {error.message.includes('yt-dlp') && (
                  <div className="mt-4 text-sm text-red-700">
                    <p className="font-semibold">To install yt-dlp:</p>
                    <code className="block mt-2 bg-red-100 p-2 text-xs">
                      sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
                    </code>
                  </div>
                )}
                {error.message.includes('ffmpeg') && (
                  <div className="mt-4 text-sm text-red-700">
                    <p className="font-semibold">To install ffmpeg:</p>
                    <code className="block mt-2 bg-red-100 p-2 text-xs">
                      sudo apt-get update && sudo apt-get install ffmpeg
                    </code>
                  </div>
                )}
              </div>
              <button
                onClick={() => setError(null)}
                className="ml-3 flex-shrink-0 text-red-500 hover:text-red-700"
              >
                <span className="sr-only">Dismiss</span>
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div className="bg-white shadow-xl p-8 border border-gray-200">
          {/* Mode Selector */}
          <div className="mb-8">
            <p className="text-sm font-semibold text-gray-700 mb-3">Select Mode</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setMode('task'); setError(null) }}
                className={`p-4 border-2 text-left transition-colors ${
                  mode === 'task'
                    ? 'border-indigo-600 bg-indigo-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="text-2xl mb-1">📋</div>
                <div className={`text-sm font-semibold ${ mode === 'task' ? 'text-indigo-700' : 'text-gray-800' }`}>
                  Task List Mode
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Extract structured tasks, priorities &amp; assignments from feedback videos
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setMode('revision'); setError(null) }}
                className={`p-4 border-2 text-left transition-colors ${
                  mode === 'revision'
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="text-2xl mb-1">✏️</div>
                <div className={`text-sm font-semibold ${ mode === 'revision' ? 'text-amber-700' : 'text-gray-800' }`}>
                  Revision Notes Mode
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Generate editor checklist with timestamped notes for promo/video review
                </div>
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Source toggle: only shown in Task List mode (Revision is Loom-only). */}
            {mode === 'task' && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Source</p>
                <div className="inline-flex border-2 border-gray-200">
                  <button
                    type="button"
                    onClick={() => { setTaskSource('loom'); setError(null) }}
                    className={`px-4 py-2 text-sm font-semibold transition-colors ${
                      taskSource === 'loom'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    🎥 Loom URL
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTaskSource('pdf'); setError(null) }}
                    className={`px-4 py-2 text-sm font-semibold transition-colors border-l-2 border-gray-200 ${
                      taskSource === 'pdf'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    📄 PDF Upload
                  </button>
                </div>
              </div>
            )}

            {isPdfSource ? (
              <div>
                <label htmlFor="pdfFile" className="block text-sm font-medium text-gray-700 mb-2">
                  PDF File
                </label>
                <label
                  htmlFor="pdfFile"
                  className={`flex flex-col items-center justify-center w-full px-4 py-8 border-2 border-dashed cursor-pointer transition-colors ${
                    pdfFile
                      ? 'border-indigo-400 bg-indigo-50'
                      : 'border-gray-300 bg-gray-50 hover:border-indigo-400 hover:bg-indigo-50'
                  }`}
                >
                  {pdfFile ? (
                    <>
                      <div className="text-3xl mb-2">📄</div>
                      <div className="text-sm font-semibold text-gray-900">{pdfFile.name}</div>
                      <div className="text-xs text-gray-500 mt-1">{(pdfFile.size / 1024).toFixed(0)} KB · click to replace</div>
                    </>
                  ) : (
                    <>
                      <div className="text-3xl mb-2 text-gray-400">📄</div>
                      <div className="text-sm font-semibold text-gray-700">Click to choose a PDF</div>
                      <div className="text-xs text-gray-500 mt-1">Tasks, images, and Loom links will be extracted from the document</div>
                    </>
                  )}
                  <input
                    id="pdfFile"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={e => setPdfFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>
            ) : (
            <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {loomUrls.length > 1 ? 'Loom Video URLs' : 'Loom Video URL'}
              </label>
              <div className="space-y-2">
                {loomUrls.map((url, i) => (
                  <div key={i} className="flex items-stretch gap-2">
                    {loomUrls.length > 1 && (
                      <span className="flex-shrink-0 inline-flex items-center px-3 bg-indigo-50 border-2 border-indigo-200 text-indigo-700 text-sm font-bold">
                        Vid {i + 1}
                      </span>
                    )}
                    <input
                      type="url"
                      id={i === 0 ? 'loomUrl' : `loomUrl-${i}`}
                      value={url}
                      onChange={e => updateUrlAt(i, e.target.value)}
                      placeholder="https://www.loom.com/share/..."
                      required={i === 0}
                      className="flex-1 px-4 py-3 text-gray-900 border-2 border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    {loomUrls.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeUrlAt(i)}
                        title="Remove this video"
                        className="flex-shrink-0 px-3 border-2 border-gray-300 text-gray-500 hover:border-red-400 hover:text-red-600 hover:bg-red-50"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500">
                  {mode === 'task' && loomUrls.length > 1
                    ? `Transcripts from all ${loomUrls.length} videos will be combined into one extraction.`
                    : 'Paste a public Loom video link'}
                </p>
                {canAddAnother && (
                  <button
                    type="button"
                    onClick={addUrlSlot}
                    className="flex-shrink-0 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
                  >
                    + Add another Loom video
                  </button>
                )}
              </div>
            </div>

            <div className="border-t-2 border-gray-200 pt-6">
              <div className="bg-blue-50 border-blue-500 p-4 mb-4">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">🔄 What is Manual Transcript?</h3>
                <p className="text-sm text-blue-800 mb-2">
                  By default, the app automatically extracts the transcript from your Loom video. However, if automatic extraction fails (due to API limitations or blocked access), you can manually paste the transcript here.
                </p>
                <p className="text-sm text-blue-800">
                  <strong>When to use:</strong> Only enable this if automatic extraction fails or if you want to provide a custom transcript.
                </p>
              </div>
              
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="manualTranscript"
                  checked={useManualTranscript}
                  onChange={(e) => setUseManualTranscript(e.target.checked)}
                  className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                  style={{borderRadius: 0}}
                />
                <label htmlFor="manualTranscript" className="ml-3 block text-sm font-medium text-gray-700">
                  Use manual transcript {error?.needsManualTranscript && <span className="text-red-600 font-bold">(⚠️ Required - Auto-extraction failed)</span>}
                </label>
              </div>

              {useManualTranscript && (
                <div>
                  <label htmlFor="transcript" className="block text-sm font-medium text-gray-700 mb-2">
                    Video Transcript
                  </label>
                  <textarea
                    id="transcript"
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="0:05 - First issue I noticed is the header is misaligned
0:15 - The button color should be blue not green
0:23 - Loading spinner is missing on the submit button

You can also paste plain text without timestamps - we'll assign them automatically!"
                    rows={10}
                    className="w-full px-4 py-3 text-gray-900 border-2 border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                  />
                  <div className="mt-3 p-4 bg-blue-50 border-2 border-blue-200">
                    <p className="text-sm font-semibold text-blue-900 mb-2">📋 How to Get Your Loom Transcript:</p>
                    <ol className="text-sm text-blue-800 space-y-1 ml-4 list-decimal">
                      <li>Open your Loom video in a browser</li>
                      <li>Click on the <strong>Transcript</strong> → <strong>Copy</strong></li>
                      <li>Patse the transcript <strong>here</strong></li>
                      <li>Or use a transcript service like <strong>otter.ai</strong> or <strong>Descript</strong></li>
                    </ol>
                    <p className="text-sm text-blue-700 mt-3">
                      <strong>Flexible formats:</strong> "0:05 - text", "[0:05] text", "At 0:05 text", or plain text without timestamps
                    </p>
                  </div>
                </div>
              )}
            </div>
            </>
            )}

            <button
              type="submit"
              disabled={isPdfSource ? !pdfFile : cleanedLoomUrls.length === 0}
              className={`w-full text-white py-4 px-6 font-semibold text-lg focus:outline-none focus:ring-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors ${
                mode === 'revision'
                  ? 'bg-amber-500 hover:bg-amber-600 focus:ring-amber-400'
                  : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500'
              }`}
            >
              {mode === 'revision' ? '✏️ Generate Revision Notes' : '📋 Extract Tasks'}
            </button>
          </form>

          <div className={`mt-8 p-4 bg-gray-100 border-l-4 ${ mode === 'revision' ? 'border-amber-500' : 'border-indigo-600' }`}>
            {mode === 'task' ? (
              <>
                <h3 className="font-semibold text-gray-900 mb-3 text-lg">📖 Task List Mode — How it works:</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                  <li><strong>Paste your Loom video URL</strong> - Just copy and paste the link</li>
                  <li><strong>Automatic transcript extraction</strong> - The app pulls the video transcript automatically</li>
                  <li><strong>AI analysis</strong> - AI identifies every task, change request, or feedback point</li>
                  <li><strong>Screenshot capture</strong> - Screenshots are captured at each timestamp</li>
                  <li><strong>Export as PDF</strong> - Get a professional PDF with clickable screenshots</li>
                </ol>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-gray-900 mb-3 text-lg">✏️ Revision Notes Mode — How it works:</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                  <li><strong>Paste your Loom review video URL</strong> - Record yourself watching and speaking notes</li>
                  <li><strong>AI structures your notes</strong> - Separates global rules from timestamped revisions</li>
                  <li><strong>Smart rewriting</strong> - Rough speech is converted to clear editor instructions</li>
                  <li><strong>Screenshots captured</strong> - Frame extracted at each revision timestamp</li>
                  <li><strong>Editor checklist generated</strong> - Mark revisions complete, edit notes, export PDF</li>
                </ol>
              </>
            )}
          </div>
        </div>

        {/* ── Loomster History ── */}
        <div className="mt-8 bg-white shadow-xl p-8 border border-gray-200">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">📚 Loomster History</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Past extractions. Click an entry to reopen.
              </p>
            </div>
            <div className="flex gap-2 items-center">
              {(['all', 'task', 'revision'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setHistoryFilter(f)}
                  className={`px-3 py-1.5 text-xs font-semibold border-2 transition-colors ${
                    historyFilter === f
                      ? f === 'task'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : f === 'revision'
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-gray-600 bg-gray-100 text-gray-800'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {f === 'all' ? `All (${history.length})`
                    : f === 'task' ? `📋 Task (${history.filter(h => h.mode === 'task').length})`
                    : `✏️ Revision (${history.filter(h => h.mode === 'revision').length})`}
                </button>
              ))}
              <button
                onClick={loadHistory}
                title="Refresh"
                className="px-3 py-1.5 text-xs font-semibold border-2 border-gray-200 bg-white text-gray-600 hover:border-gray-400">
                ↻
              </button>
            </div>
          </div>

          {historyError && (
            <div className="bg-red-50 border-2 border-red-300 text-red-800 text-sm px-3 py-2 mb-3">
              {historyError}
            </div>
          )}

          {historyLoading && history.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">Loading history…</div>
          ) : history.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              No extractions yet. Process a Loom video above to get started.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 border-2 border-gray-200">
              {history
                .filter(h => historyFilter === 'all' ? true : h.mode === historyFilter)
                .map(h => (
                  <li
                    key={h.id}
                    onClick={() => router.push(`/result/${h.id}`)}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <span className={`text-xs font-bold px-2 py-1 border whitespace-nowrap flex-shrink-0 mt-0.5 ${
                      h.mode === 'task'
                        ? 'bg-indigo-100 text-indigo-800 border-indigo-300'
                        : 'bg-amber-100 text-amber-800 border-amber-300'
                    }`}>
                      {h.mode === 'task' ? '📋 TASK' : '✏️ REVISION'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm text-gray-800 truncate">{historyDisplayName(h.created_at)}</p>
                      <p className="text-sm text-gray-600 truncate">
                        {h.title || <span className="text-gray-400 italic">(untitled)</span>}
                        <span className="text-gray-400"> · {h.item_count} {h.mode === 'task' ? `task${h.item_count === 1 ? '' : 's'}` : `note${h.item_count === 1 ? '' : 's'}`}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(h.created_at).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteHistoryItem(h.id) }}
                      title="Delete from history"
                      className="text-gray-300 hover:text-red-600 text-xl leading-none px-2 py-1 flex-shrink-0"
                    >
                      ×
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
