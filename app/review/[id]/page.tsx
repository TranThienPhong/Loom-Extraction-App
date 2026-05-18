'use client'

import { useState, useEffect, useCallback, use } from 'react'

interface RevisionScreenshot {
  timestamp_seconds: number
  timestamp_label: string
  image_url: string
  image_base64?: string
}

interface GlobalNote {
  id: string
  note: string
  completed: boolean
}

interface RevisionNote {
  id: string
  note_type: 'timestamped'
  timestamp_seconds: number
  timestamp_label: string
  referenced_timestamp_seconds?: number | null
  referenced_timestamp_label?: string | null
  note: string
  raw_speech?: string
  completed: boolean
  loom_url?: string
  screenshots?: RevisionScreenshot[]
}

interface ReviewSession {
  id: string
  title: string
  summary: string
  loom_url: string
  video_id: string
  global_notes: GlobalNote[]
  revision_notes: RevisionNote[]
  transcript: { t: string; s: string }[]
  created_at: string
  updated_at: string
}

type FilterType = 'all' | 'pending' | 'completed' | 'global'

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [session, setSession] = useState<ReviewSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')
  const [saving, setSaving] = useState<string | null>(null)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // Share modal
  const [showShareModal, setShowShareModal] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  // Lightbox
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [lightboxLabel, setLightboxLabel] = useState('')
  const [lightboxScreenshots, setLightboxScreenshots] = useState<RevisionScreenshot[]>([])
  const [lightboxIndex, setLightboxIndex] = useState(0)

  useEffect(() => {
    fetch(`/api/review-sessions/${id}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        if (!r.ok) throw new Error('fetch failed')
        return r.json()
      })
      .then(data => { if (data) setSession(data) })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!lightboxImage) return
      if (e.key === 'Escape') { setLightboxImage(null); return }
      if (lightboxScreenshots.length <= 1) return
      if (e.key === 'ArrowLeft') {
        const ni = (lightboxIndex - 1 + lightboxScreenshots.length) % lightboxScreenshots.length
        setLightboxIndex(ni)
        const s = lightboxScreenshots[ni]
        setLightboxImage(s.image_base64 || s.image_url)
        setLightboxLabel(s.timestamp_label)
      } else if (e.key === 'ArrowRight') {
        const ni = (lightboxIndex + 1) % lightboxScreenshots.length
        setLightboxIndex(ni)
        const s = lightboxScreenshots[ni]
        setLightboxImage(s.image_base64 || s.image_url)
        setLightboxLabel(s.timestamp_label)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [lightboxImage, lightboxIndex, lightboxScreenshots])

  const openLightbox = (screenshots: RevisionScreenshot[], index: number) => {
    const s = screenshots[index]
    setLightboxScreenshots(screenshots)
    setLightboxIndex(index)
    setLightboxImage(s.image_base64 || s.image_url)
    setLightboxLabel(s.timestamp_label)
  }

  const loomTimestampUrl = useCallback((ts: number) => {
    if (!session) return ''
    return session.video_id
      ? `https://www.loom.com/share/${session.video_id}?t=${ts}`
      : session.loom_url || ''
  }, [session])

  const toggleNote = async (noteId: string, noteType: 'global' | 'revision', current: boolean) => {
    if (!session) return
    setSaving(noteId)
    const newVal = !current

    // Optimistic update
    setSession(prev => {
      if (!prev) return prev
      if (noteType === 'global') {
        return { ...prev, global_notes: prev.global_notes.map(n => n.id === noteId ? { ...n, completed: newVal } : n) }
      }
      return { ...prev, revision_notes: prev.revision_notes.map(n => n.id === noteId ? { ...n, completed: newVal } : n) }
    })

    try {
      const r = await fetch(`/api/review-sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'complete', noteId, noteType, completed: newVal }),
      })
      if (!r.ok) throw new Error('save failed')
    } catch {
      // Revert on error
      setSession(prev => {
        if (!prev) return prev
        if (noteType === 'global') {
          return { ...prev, global_notes: prev.global_notes.map(n => n.id === noteId ? { ...n, completed: current } : n) }
        }
        return { ...prev, revision_notes: prev.revision_notes.map(n => n.id === noteId ? { ...n, completed: current } : n) }
      })
    } finally {
      setSaving(null)
    }
  }

  const startEditNote = (id: string, text: string) => {
    setEditingId(id)
    setEditText(text)
  }

  const saveEditNote = async (noteId: string, noteType: 'global' | 'revision') => {
    const prevText = noteType === 'global'
      ? session?.global_notes.find(n => n.id === noteId)?.note ?? ''
      : session?.revision_notes.find(n => n.id === noteId)?.note ?? ''
    const nextText = editText.trim() || prevText
    setEditingId(null)
    setSession(prev => {
      if (!prev) return prev
      if (noteType === 'global') {
        return { ...prev, global_notes: prev.global_notes.map(n => n.id === noteId ? { ...n, note: nextText } : n) }
      }
      return { ...prev, revision_notes: prev.revision_notes.map(n => n.id === noteId ? { ...n, note: nextText } : n) }
    })
    try {
      await fetch(`/api/review-sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'edit', noteId, noteType, note: nextText }),
      })
    } catch {
      setSession(prev => {
        if (!prev) return prev
        if (noteType === 'global') {
          return { ...prev, global_notes: prev.global_notes.map(n => n.id === noteId ? { ...n, note: prevText } : n) }
        }
        return { ...prev, revision_notes: prev.revision_notes.map(n => n.id === noteId ? { ...n, note: prevText } : n) }
      })
    }
  }

  const deleteNote = async (noteId: string, noteType: 'global' | 'revision') => {
    const snapshot = session ? { global_notes: [...session.global_notes], revision_notes: [...session.revision_notes] } : null
    setSession(prev => {
      if (!prev) return prev
      if (noteType === 'global') return { ...prev, global_notes: prev.global_notes.filter(n => n.id !== noteId) }
      return { ...prev, revision_notes: prev.revision_notes.filter(n => n.id !== noteId) }
    })
    try {
      await fetch(`/api/review-sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'delete', noteId, noteType }),
      })
    } catch {
      if (snapshot) setSession(prev => prev ? { ...prev, ...snapshot } : prev)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">Loading review session…</p>
        </div>
      </div>
    )
  }

  if (notFound || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Review not found</h1>
          <p className="text-gray-600 mb-6">This review session does not exist or may have been removed.</p>
          <a href="/" className="bg-amber-500 text-black px-6 py-2 font-semibold hover:bg-amber-600 transition-colors border-2 border-amber-600">
            ← Go Home
          </a>
        </div>
      </div>
    )
  }

  const { title, summary, loom_url, global_notes, revision_notes, transcript, created_at } = session
  const completedCount = revision_notes.filter(n => n.completed).length + global_notes.filter(n => n.completed).length
  const pendingCount = revision_notes.filter(n => !n.completed).length + global_notes.filter(n => !n.completed).length
  const totalCount = global_notes.length + revision_notes.length
  const revisionPendingCount = revision_notes.filter(n => !n.completed).length
  const revisionCompletedCount = revision_notes.filter(n => n.completed).length

  const visibleRevisionNotes = revision_notes.filter(n => {
    if (filter === 'pending') return !n.completed
    if (filter === 'completed') return n.completed
    if (filter === 'global') return false
    return true
  })
  const showGlobalSection = filter === 'all' || filter === 'global'

  const shareUrl = typeof window !== 'undefined' ? window.location.href : `${process.env.NEXT_PUBLIC_SITE_URL || ''}/review/${id}`

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap justify-between items-start gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 border border-amber-200">
                ✏️ REVISION NOTES
              </span>
              <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 border border-blue-200">
                🔗 SHARED REVIEW
              </span>
            </div>
            <h1 className="text-4xl font-bold text-gray-900">{title}</h1>
            <p className="text-gray-500 mt-1">
              {global_notes.length} global note{global_notes.length !== 1 ? 's' : ''} · {revision_notes.length} timestamped revision{revision_notes.length !== 1 ? 's' : ''}
              <span className="ml-2 text-gray-400">· Created {new Date(created_at).toLocaleDateString()}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowShareModal(true)}
              className="bg-blue-600 text-white px-5 py-2 font-semibold hover:bg-blue-700 transition-colors border-2 border-blue-700"
            >
              🔗 Share Link
            </button>
            {loom_url && (
              <a href={loom_url} target="_blank" rel="noreferrer"
                className="bg-indigo-600 text-white px-5 py-2 font-semibold hover:bg-indigo-700 transition-colors border-2 border-indigo-700">
                ▶ Open Video
              </a>
            )}
            <a href="/" className="bg-gray-200 text-gray-700 px-5 py-2 font-semibold hover:bg-gray-300 transition-colors border-2 border-gray-300">
              ← New Video
            </a>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-amber-50 border-2 border-amber-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-amber-800">📋 Progress</h2>
            <div className="text-right">
              <span className="text-3xl font-bold text-amber-600">{completedCount}</span>
              <span className="text-gray-400 text-xl">/{totalCount}</span>
              <div className="text-xs text-gray-500 mt-0.5">completed</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-gray-600"><span className="font-semibold text-indigo-700">{global_notes.length}</span> global</span>
            <span className="text-gray-600"><span className="font-semibold text-amber-700">{revision_notes.length}</span> timestamped</span>
            <span className="text-gray-600"><span className="font-semibold text-green-700">{completedCount}</span> done</span>
            <span className="text-gray-600"><span className="font-semibold text-red-600">{pendingCount}</span> pending</span>
            {loom_url && (
              <a href={loom_url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-indigo-600 hover:underline font-medium">
                ↗ Open source video
              </a>
            )}
          </div>
        </div>

        {/* Summary */}
        {summary && (
          <div className="bg-indigo-50 border-2 border-indigo-200 p-5 mb-6">
            <h2 className="text-lg font-bold text-indigo-800">📋 Video Summary</h2>
            <p className="text-gray-700 leading-relaxed mt-2">{summary}</p>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex border-b-2 border-gray-200 mb-6 bg-white">
          {(['all', 'pending', 'completed', 'global'] as FilterType[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                filter === f
                  ? 'border-amber-500 text-amber-700'
                  : 'border-transparent text-gray-700 hover:text-gray-900'
              }`}
            >
              {f === 'all' ? `All (${totalCount})` :
               f === 'pending' ? `Timestamp Notes (${revisionPendingCount})` :
               f === 'completed' ? `Completed (${revisionCompletedCount})` :
               `Global Notes (${global_notes.length})`}
            </button>
          ))}
        </div>

        {/* Global Notes */}
        {showGlobalSection && global_notes.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">🌐 Global Notes</h2>
            <div className="space-y-3">
              {global_notes.map(note => (
                <div
                  key={note.id}
                  className={`bg-white shadow-md overflow-hidden transition-shadow border-2 ${
                    note.completed ? 'border-green-300 opacity-80' : 'border-gray-200 hover:shadow-lg'
                  }`}
                >
                  <div className="p-5">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => toggleNote(note.id, 'global', note.completed)}
                        disabled={saving === note.id}
                        className={`mt-0.5 w-5 h-5 flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                          note.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-indigo-500'
                        } ${saving === note.id ? 'opacity-50 cursor-wait' : ''}`}
                      >
                        {note.completed && <span className="text-xs">✓</span>}
                      </button>
                      <div className="flex-1 min-w-0">
                        {editingId === note.id ? (
                          <div>
                            <textarea value={editText} onChange={e => setEditText(e.target.value)}
                              className="w-full border-2 border-amber-400 px-3 py-2 text-gray-800 resize-none focus:outline-none focus:border-amber-600" rows={3}
                              autoFocus onKeyDown={e => { if (e.key === 'Escape') setEditingId(null) }} />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => saveEditNote(note.id, 'global')} className="px-4 py-1.5 text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600">✓ Save</button>
                              <button onClick={() => setEditingId(null)} className="px-4 py-1.5 text-sm text-black font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <p className={`text-base leading-relaxed ${note.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                            {note.note}
                          </p>
                        )}
                      </div>
                      {editingId !== note.id && (
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => startEditNote(note.id, note.note)} title="Edit"
                            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-amber-600 hover:bg-amber-50 border border-gray-200 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button onClick={() => deleteNote(note.id, 'global')} title="Delete"
                            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 border border-gray-200 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timestamped Revision Notes */}
        {filter !== 'global' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              ⏱ Timestamped Revision Notes
              {visibleRevisionNotes.length !== revision_notes.length && (
                <span className="text-sm font-normal text-gray-500 ml-2">
                  — showing {visibleRevisionNotes.length} of {revision_notes.length}
                </span>
              )}
            </h2>

            {visibleRevisionNotes.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-2xl mb-3">{filter === 'pending' ? 'All revisions complete! 🎉' : 'No notes to show.'}</p>
              </div>
            ) : (
              <div className="space-y-5">
                {visibleRevisionNotes.map((note, idx) => {
                  const shots = (note.screenshots || []).filter(s => s.image_base64 || s.image_url)
                  return (
                    <div
                      key={note.id}
                      className={`bg-white shadow-md overflow-hidden transition-shadow border-2 ${
                        note.completed ? 'border-green-300 opacity-80' : 'border-gray-200 hover:shadow-xl'
                      }`}
                    >
                      <div className="p-6">
                        <div className="flex items-start gap-3 mb-3">
                          <button
                            onClick={() => toggleNote(note.id, 'revision', note.completed)}
                            disabled={saving === note.id}
                            className={`mt-1 w-5 h-5 flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                              note.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-amber-500'
                            } ${saving === note.id ? 'opacity-50 cursor-wait' : ''}`}
                          >
                            {note.completed && <span className="text-xs">✓</span>}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="inline-block bg-amber-100 text-amber-800 text-sm font-semibold px-3 py-1 border border-amber-300">
                                ⏱ {note.referenced_timestamp_label || note.timestamp_label}
                              </span>
                              {note.loom_url && (
                                <a href={note.loom_url} target="_blank" rel="noreferrer"
                                  className="inline-block bg-indigo-600 text-white text-xs font-semibold px-3 py-1 hover:bg-indigo-700 transition-colors border-2 border-indigo-700">
                                  ↗ Jump to video
                                </a>
                              )}
                              <span className="text-xs text-gray-400 ml-auto">#{idx + 1}</span>
                            </div>
                            {editingId === note.id ? (
                              <div>
                                <textarea value={editText} onChange={e => setEditText(e.target.value)}
                                  className="w-full border-2 border-amber-400 px-3 py-2 text-gray-800 resize-none focus:outline-none focus:border-amber-600" rows={3}
                                  autoFocus onKeyDown={e => { if (e.key === 'Escape') setEditingId(null) }} />
                                <div className="flex gap-2 mt-2">
                                  <button onClick={() => saveEditNote(note.id, 'revision')} className="px-4 py-1.5 text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600">✓ Save</button>
                                  <button onClick={() => setEditingId(null)} className="px-4 py-1.5 text-sm text-black font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className={`text-gray-700 leading-relaxed ${note.completed ? 'line-through text-gray-400' : ''}`}>
                                  {note.note}
                                </p>
                                {note.raw_speech && note.raw_speech !== note.note && (
                                  <p className="mt-2 text-sm text-gray-400 italic">
                                    Original: &ldquo;{note.raw_speech}&rdquo;
                                  </p>
                                )}
                              </>
                            )}
                          </div>

                          {editingId !== note.id && (
                            <div className="flex gap-1 flex-shrink-0">
                              <button onClick={() => startEditNote(note.id, note.note)} title="Edit"
                                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-amber-600 hover:bg-amber-50 border border-gray-200 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                              <button onClick={() => deleteNote(note.id, 'revision')} title="Delete"
                                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 border border-gray-200 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Screenshots */}
                        {shots.length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                              Screenshots ({shots.length})
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                              {shots.map((shot, si) => {
                                const src = shot.image_base64 || shot.image_url
                                const shotTimestampUrl = shot.timestamp_seconds
                                  ? loomTimestampUrl(shot.timestamp_seconds)
                                  : (note.loom_url || loomTimestampUrl(note.timestamp_seconds))
                                return (
                                  <div
                                    key={si}
                                    className="border-2 border-gray-200 hover:border-amber-500 transition-colors cursor-pointer group relative overflow-hidden"
                                  >
                                    <img
                                      src={src}
                                      alt={`Screenshot at ${shot.timestamp_label}`}
                                      className="w-full h-auto block"
                                      onClick={() => openLightbox(shots, si)}
                                    />
                                    {shotTimestampUrl && (
                                      <a
                                        href={shotTimestampUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="absolute bottom-2 left-2 bg-black bg-opacity-75 hover:bg-opacity-90 text-white text-xs font-bold px-2 py-1 rounded shadow z-10"
                                      >
                                        ⏱ {shot.timestamp_label}
                                      </a>
                                    )}
                                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-25 transition-all flex items-center justify-center pointer-events-none">
                                      <span className="text-white font-semibold text-sm opacity-0 group-hover:opacity-100 transition-opacity drop-shadow">
                                        🔍 Enlarge
                                      </span>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Transcript */}
        {transcript.length > 0 && (
          <div className="mt-10 border-t-2 border-gray-200 pt-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">📝 Full Transcript</h2>
            <div className="bg-white border-2 border-gray-200 divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
              {transcript.map((line, i) => (
                <div key={i} className="flex gap-4 px-4 py-2.5 hover:bg-gray-50">
                  <span className="text-xs font-mono font-semibold text-indigo-500 mt-0.5 flex-shrink-0 w-12">{line.t}</span>
                  <span className="text-sm text-gray-700 leading-relaxed">{line.s}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-7xl w-full">
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute top-3 right-4 text-gray-300 text-4xl font-bold hover:text-white z-10 w-12 h-12 flex items-center justify-center"
            >
              ×
            </button>

            {lightboxScreenshots.length > 1 && (
              <>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const ni = (lightboxIndex - 1 + lightboxScreenshots.length) % lightboxScreenshots.length
                    setLightboxIndex(ni)
                    const s = lightboxScreenshots[ni]
                    setLightboxImage(s.image_base64 || s.image_url)
                    setLightboxLabel(s.timestamp_label)
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white text-5xl font-bold hover:text-gray-300 z-10 w-14 h-14 flex items-center justify-center"
                >
                  ‹
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const ni = (lightboxIndex + 1) % lightboxScreenshots.length
                    setLightboxIndex(ni)
                    const s = lightboxScreenshots[ni]
                    setLightboxImage(s.image_base64 || s.image_url)
                    setLightboxLabel(s.timestamp_label)
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white text-5xl font-bold hover:text-gray-300 z-10 w-14 h-14 flex items-center justify-center"
                >
                  ›
                </button>
              </>
            )}

            <div className="bg-white p-2" onClick={e => e.stopPropagation()}>
              <img
                src={lightboxImage}
                alt={`Screenshot at ${lightboxLabel}`}
                className="w-full h-auto max-h-[85vh] object-contain"
              />
              <p className="text-center mt-2 text-gray-700 font-semibold text-sm py-1">
                ⏱ {lightboxLabel}
                {lightboxScreenshots.length > 1 && (
                  <span className="ml-2 text-gray-400">({lightboxIndex + 1}/{lightboxScreenshots.length})</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={() => setShowShareModal(false)}>
          <div className="bg-white max-w-lg w-full p-8 shadow-2xl border-2 border-blue-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">🔗 Share This Review</h2>
                <p className="text-gray-600 mt-1 text-sm">Anyone with this link can view and check off revision notes.</p>
              </div>
              <button onClick={() => setShowShareModal(false)} className="text-gray-400 hover:text-gray-700 text-2xl font-bold w-8 h-8 flex items-center justify-center">×</button>
            </div>
            <div className="bg-gray-50 border-2 border-gray-200 p-3 mb-5 break-all text-sm text-gray-800 font-mono select-all">{shareUrl}</div>
            <div className="flex gap-3">
              <button
                onClick={() => { navigator.clipboard?.writeText(shareUrl).then(() => { setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000) }).catch(() => {}) }}
                className={`flex-1 py-2.5 font-semibold border-2 transition-colors ${copySuccess ? 'bg-green-100 border-green-400 text-green-700' : 'bg-blue-600 border-blue-700 text-white hover:bg-blue-700'}`}
              >
                {copySuccess ? '✓ Copied!' : '📋 Copy Link'}
              </button>
              <a href={shareUrl} target="_blank" rel="noreferrer"
                className="flex-1 py-2.5 font-semibold border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 transition-colors text-center">
                ↗ Open Link
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
