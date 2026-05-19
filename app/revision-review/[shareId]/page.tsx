'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

type Status = 'not_started' | 'in_progress' | 'blocked' | 'needs_review' | 'completed'

const STATUS_OPTIONS: { value: Status; label: string; chip: string; dot: string }[] = [
  { value: 'not_started',  label: 'Not Started',  chip: 'bg-gray-100 text-gray-700 border-gray-300',   dot: 'bg-gray-400' },
  { value: 'in_progress',  label: 'In Progress',  chip: 'bg-blue-50 text-blue-800 border-blue-300',    dot: 'bg-blue-500' },
  { value: 'blocked',      label: 'Blocked',      chip: 'bg-red-50 text-red-800 border-red-300',       dot: 'bg-red-500' },
  { value: 'needs_review', label: 'Needs Review', chip: 'bg-yellow-50 text-yellow-800 border-yellow-300', dot: 'bg-yellow-500' },
  { value: 'completed',    label: 'Completed',    chip: 'bg-green-50 text-green-800 border-green-300', dot: 'bg-green-500' },
]
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map(o => [o.value, o.label])) as Record<Status, string>
const STATUS_CHIP  = Object.fromEntries(STATUS_OPTIONS.map(o => [o.value, o.chip]))  as Record<Status, string>
const STATUS_DOT   = Object.fromEntries(STATUS_OPTIONS.map(o => [o.value, o.dot]))   as Record<Status, string>

interface SessionData {
  id: string
  share_id: string
  title: string
  summary: string | null
  video_id: string | null
  loom_url: string | null
  owner_name: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
}
interface GlobalNote {
  id: string
  position: number
  note: string
  assigned_to: string | null
  status: Status
  status_updated_at: string | null
  status_updated_by: string | null
}
interface Screenshot {
  id: string
  position: number
  timestamp_seconds: number
  timestamp_label: string
  image_data: string | null
  image_url: string | null
}
interface TimedNote {
  id: string
  position: number
  title: string | null
  note: string
  raw_speech: string | null
  timestamp_seconds: number
  timestamp_label: string
  referenced_timestamp_seconds: number | null
  referenced_timestamp_label: string | null
  loom_url: string | null
  assigned_to: string | null
  status: Status
  status_updated_at: string | null
  status_updated_by: string | null
  screenshots: Screenshot[]
}
interface Comment {
  id: string
  item_type: 'global' | 'timed'
  item_id: string
  user_name: string
  comment: string
  created_at: string
}

const LETTER_LABEL = (i: number) => {
  // A..Z, AA..ZZ
  let n = i, s = ''
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
    if (n < 0) break
  }
  return s
}

export default function EditorReviewPage() {
  const params = useParams<{ shareId: string }>()
  const shareId = params?.shareId

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [session, setSession] = useState<SessionData | null>(null)
  const [globals, setGlobals] = useState<GlobalNote[]>([])
  const [timed, setTimed]     = useState<TimedNote[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [userName, setUserName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [showNamePrompt, setShowNamePrompt] = useState(false)
  const [userOptions, setUserOptions] = useState<string[]>([])
  const [usersLoading, setUsersLoading] = useState(false)

  // Comment composer state — per-item
  const [openCommentFor, setOpenCommentFor] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  // Filter
  type Filter = 'all' | 'pending' | 'completed'
  const [filter, setFilter] = useState<Filter>('all')

  // Lightbox
  const [lbImage, setLbImage] = useState<string | null>(null)
  const [lbLabel, setLbLabel] = useState('')
  const [lbList, setLbList] = useState<Screenshot[]>([])
  const [lbIndex, setLbIndex] = useState(0)

  const pollRef = useRef<number | null>(null)

  const refresh = useCallback(async (silent = false): Promise<void> => {
    try {
      if (!silent) setLoading(true)
      const res = await fetch(`/api/revision-review/${shareId}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setSession(data.session)
      setGlobals(data.global_notes || [])
      setTimed(data.timed_notes || [])
      setComments(data.comments || [])
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Failed to load review session')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [shareId])

  useEffect(() => {
    if (!shareId) return
    refresh()
    // Poll for live updates from other editors / manager.
    pollRef.current = window.setInterval(() => { refresh(true) }, 8000)
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
  }, [shareId, refresh])

  // Editor identity (localStorage)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = localStorage.getItem('reviewEditorName') || ''
    if (stored) {
      setUserName(stored)
    } else {
      setShowNamePrompt(true)
    }
  }, [])

  // Load users for the name dropdown (same source as Task mode assignees)
  useEffect(() => {
    if (!showNamePrompt || userOptions.length > 0 || usersLoading) return
    setUsersLoading(true)
    fetch('/api/users')
      .then(r => r.json())
      .then(j => setUserOptions(Array.isArray(j.users) ? j.users : []))
      .catch(() => setUserOptions([]))
      .finally(() => setUsersLoading(false))
  }, [showNamePrompt, userOptions.length, usersLoading])

  const saveName = () => {
    const name = nameDraft.trim()
    if (!name) return
    localStorage.setItem('reviewEditorName', name)
    setUserName(name)
    setShowNamePrompt(false)
  }

  const changeName = () => {
    setNameDraft(userName)
    setShowNamePrompt(true)
  }

  // Lightbox keyboard nav
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!lbImage) return
      if (e.key === 'Escape') { setLbImage(null); return }
      if (lbList.length <= 1) return
      if (e.key === 'ArrowLeft') {
        const ni = (lbIndex - 1 + lbList.length) % lbList.length
        setLbIndex(ni); const s = lbList[ni]
        setLbImage(s.image_data || s.image_url); setLbLabel(s.timestamp_label)
      } else if (e.key === 'ArrowRight') {
        const ni = (lbIndex + 1) % lbList.length
        setLbIndex(ni); const s = lbList[ni]
        setLbImage(s.image_data || s.image_url); setLbLabel(s.timestamp_label)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [lbImage, lbIndex, lbList])

  const openLightbox = (shots: Screenshot[], idx: number) => {
    const s = shots[idx]
    setLbList(shots); setLbIndex(idx)
    setLbImage(s.image_data || s.image_url); setLbLabel(s.timestamp_label)
  }

  const loomTimestampUrl = (ts: number) => {
    if (!session) return ''
    if (session.video_id) return `https://www.loom.com/share/${session.video_id}?t=${Math.floor(ts)}`
    return session.loom_url || ''
  }

  // Optimistic status change
  const setStatus = async (itemType: 'global' | 'timed', itemId: string, newStatus: Status) => {
    if (itemType === 'global') {
      setGlobals(prev => prev.map(n => n.id === itemId ? { ...n, status: newStatus } : n))
    } else {
      setTimed(prev => prev.map(n => n.id === itemId ? { ...n, status: newStatus } : n))
    }
    try {
      const res = await fetch(`/api/revision-review/${shareId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType, itemId, status: newStatus, userName }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      // Soft refresh to pick up status_updated_at/by
      refresh(true)
    } catch (e: any) {
      alert('Failed to update status: ' + e.message)
      refresh(true)
    }
  }

  const submitComment = async (itemType: 'global' | 'timed', itemId: string) => {
    const text = commentDraft.trim()
    if (!text) return
    if (!userName) { setShowNamePrompt(true); return }
    setPostingComment(true)
    try {
      const res = await fetch(`/api/revision-review/${shareId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType, itemId, userName, comment: text }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const j = await res.json()
      setComments(prev => [...prev, j.comment])
      setCommentDraft('')
      setOpenCommentFor(null)
    } catch (e: any) {
      alert('Failed to add comment: ' + e.message)
    } finally {
      setPostingComment(false)
    }
  }

  // Derived counts
  const totalItems = globals.length + timed.length
  const completedItems =
    globals.filter(g => g.status === 'completed').length +
    timed.filter(t => t.status === 'completed').length
  const blockedItems =
    globals.filter(g => g.status === 'blocked').length +
    timed.filter(t => t.status === 'blocked').length
  const inReviewItems =
    globals.filter(g => g.status === 'needs_review').length +
    timed.filter(t => t.status === 'needs_review').length
  const inProgressItems =
    globals.filter(g => g.status === 'in_progress').length +
    timed.filter(t => t.status === 'in_progress').length
  const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0

  const commentsByItem = useMemo(() => {
    const m = new Map<string, Comment[]>()
    for (const c of comments) {
      const key = `${c.item_type}:${c.item_id}`
      const arr = m.get(key) || []
      arr.push(c); m.set(key, arr)
    }
    return m
  }, [comments])

  const visibleTimed = timed.filter(n => {
    if (filter === 'pending')    return n.status !== 'completed'
    if (filter === 'completed')  return n.status === 'completed'
    return true
  })
  const visibleGlobals = globals.filter(n => {
    if (filter === 'pending')    return n.status !== 'completed'
    if (filter === 'completed')  return n.status === 'completed'
    return true
  })

  // ── Loading / error states ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">Loading review session...</p>
        </div>
      </div>
    )
  }
  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white border-2 border-red-300 p-6 max-w-md text-center">
          <p className="text-red-700 font-semibold mb-2">Couldn&apos;t load review</p>
          <p className="text-gray-600 text-sm">{error || 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 border border-amber-200">
                ✏️ EDITOR REVIEW
              </span>
              <span className="text-xs text-gray-500">
                {session.assigned_to ? `Assigned to: ${session.assigned_to}` : 'Shareable tracking page'}
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">{session.title}</h1>
            <p className="text-gray-500 mt-1 text-sm">
              {session.owner_name ? `Owner: ${session.owner_name}  ·  ` : ''}
              Created {new Date(session.created_at).toLocaleDateString()}
              {' '}·{' '}
              {globals.length} global · {timed.length} timestamped
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <div className="text-xs text-gray-500 px-3 py-1.5 bg-white border border-gray-300">
              <span className="text-gray-400">Editor:</span>{' '}
              <span className="font-semibold text-gray-800">{userName || '— not set —'}</span>
              <button onClick={changeName} className="ml-2 text-indigo-600 hover:underline">change</button>
            </div>
            {session.loom_url && (
              <a href={session.loom_url} target="_blank" rel="noreferrer"
                 className="text-xs px-3 py-1.5 bg-indigo-600 text-white font-semibold hover:bg-indigo-700 border-2 border-indigo-700">
                ↗ Open source video
              </a>
            )}
          </div>
        </div>

        {/* ── Progress bar ────────────────────────────────────────────── */}
        <div className="bg-amber-50 border-2 border-amber-200 p-5 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-bold text-amber-800">📋 Completion Progress</h2>
            <div className="text-right">
              <span className="text-3xl font-bold text-amber-600">{completedItems}</span>
              <span className="text-gray-400 text-xl">/{totalItems}</span>
              <span className="ml-2 text-sm text-gray-500">({pct}%)</span>
            </div>
          </div>
          <div className="w-full h-3 bg-white border border-amber-200 overflow-hidden mb-3">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-gray-700"><span className="inline-block w-2 h-2 bg-gray-400 mr-1 align-middle"/>{globals.filter(g=>g.status==='not_started').length + timed.filter(t=>t.status==='not_started').length} not started</span>
            <span className="text-gray-700"><span className="inline-block w-2 h-2 bg-blue-500 mr-1 align-middle"/>{inProgressItems} in progress</span>
            <span className="text-gray-700"><span className="inline-block w-2 h-2 bg-yellow-500 mr-1 align-middle"/>{inReviewItems} needs review</span>
            <span className="text-gray-700"><span className="inline-block w-2 h-2 bg-red-500 mr-1 align-middle"/>{blockedItems} blocked</span>
            <span className="text-gray-700"><span className="inline-block w-2 h-2 bg-green-500 mr-1 align-middle"/>{completedItems} completed</span>
          </div>
        </div>

        {/* ── Summary ────────────────────────────────────────────────── */}
        {session.summary && (
          <div className="bg-indigo-50 border-2 border-indigo-200 p-5 mb-6">
            <h2 className="text-sm font-bold text-indigo-800 uppercase tracking-wide mb-1">Video Summary</h2>
            <p className="text-gray-700 leading-relaxed">{session.summary}</p>
          </div>
        )}

        {/* ── Filter tabs ────────────────────────────────────────────── */}
        <div className="flex border-b-2 border-gray-200 mb-6 bg-white">
          {(['all', 'pending', 'completed'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                filter === f
                  ? 'border-amber-500 text-amber-700'
                  : 'border-transparent text-gray-700 hover:text-gray-900'
              }`}
            >
              {f === 'all' ? `All (${totalItems})`
                : f === 'pending' ? `Pending (${totalItems - completedItems})`
                : `Completed (${completedItems})`}
            </button>
          ))}
        </div>

        {/* ── Global Notes ──────────────────────────────────────────── */}
        {visibleGlobals.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">🌐 Global Notes</h2>
            <div className="bg-white border-2 border-indigo-200 divide-y divide-indigo-100">
              {visibleGlobals.map((g) => {
                const idx = globals.findIndex(x => x.id === g.id)
                const letter = LETTER_LABEL(idx)
                const itemComments = commentsByItem.get(`global:${g.id}`) || []
                const composerKey = `global:${g.id}`
                return (
                  <div key={g.id} className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="inline-flex w-8 h-8 items-center justify-center bg-indigo-100 text-indigo-800 font-bold border border-indigo-300 flex-shrink-0">
                        {letter}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-base leading-relaxed ${g.status==='completed' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                          {g.note}
                        </p>
                        {g.assigned_to && (
                          <p className="text-xs text-gray-500 mt-1">Assigned to: <span className="font-semibold text-gray-700">{g.assigned_to}</span></p>
                        )}
                        <StatusFooter status={g.status} updatedBy={g.status_updated_by} updatedAt={g.status_updated_at}/>
                      </div>
                      <div className="flex-shrink-0">
                        <StatusPicker value={g.status} onChange={(s) => setStatus('global', g.id, s)} />
                      </div>
                    </div>

                    {/* Comments thread */}
                    <CommentThread
                      comments={itemComments}
                      open={openCommentFor === composerKey}
                      onToggleOpen={() => setOpenCommentFor(openCommentFor === composerKey ? null : composerKey)}
                      draft={openCommentFor === composerKey ? commentDraft : ''}
                      onDraftChange={setCommentDraft}
                      onSubmit={() => submitComment('global', g.id)}
                      posting={postingComment}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Timed Notes ──────────────────────────────────────────── */}
        <h2 className="text-2xl font-bold text-gray-900 mb-4">⏱ Timed Revision Notes</h2>

        {visibleTimed.length === 0 ? (
          <div className="text-center py-16 text-gray-400 bg-white border-2 border-gray-200">
            <p className="text-xl">
              {filter === 'pending' ? 'All revisions complete! 🎉' : 'No notes to show.'}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {visibleTimed.map((n) => {
              const num = timed.findIndex(x => x.id === n.id) + 1
              const itemComments = commentsByItem.get(`timed:${n.id}`) || []
              const composerKey = `timed:${n.id}`
              const noteUrl = n.loom_url || loomTimestampUrl(n.timestamp_seconds)
              const tsDisplay = n.referenced_timestamp_label || n.timestamp_label
              return (
                <div key={n.id} className={`bg-white shadow-md border-2 ${ n.status==='completed' ? 'border-green-300' : 'border-gray-200' }`}>
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-start gap-3 mb-3">
                      <span className="inline-flex h-8 min-w-[2.5rem] px-2 items-center justify-center bg-amber-100 text-amber-800 font-bold border border-amber-300">
                        #{num}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {noteUrl ? (
                            <a href={noteUrl} target="_blank" rel="noreferrer"
                              className="inline-block bg-amber-100 text-amber-800 text-sm font-semibold px-3 py-1 border border-amber-300 hover:bg-amber-200">
                              ⏱ {tsDisplay}
                            </a>
                          ) : (
                            <span className="inline-block bg-amber-100 text-amber-800 text-sm font-semibold px-3 py-1 border border-amber-300">
                              ⏱ {tsDisplay}
                            </span>
                          )}
                          {noteUrl && (
                            <a href={noteUrl} target="_blank" rel="noreferrer"
                              className="text-xs text-indigo-700 hover:underline">↗ Jump to video</a>
                          )}
                          {n.assigned_to && (
                            <span className="text-xs text-gray-500 ml-auto">Assigned: <span className="font-semibold text-gray-700">{n.assigned_to}</span></span>
                          )}
                        </div>
                        {n.title && (
                          <p className={`text-lg font-bold mb-1 ${n.status==='completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                            #{num} {n.title}
                          </p>
                        )}
                        <p className={`text-gray-700 leading-relaxed whitespace-pre-line ${n.status==='completed' ? 'line-through text-gray-400' : ''}`}>
                          {n.note}
                        </p>
                        {n.raw_speech && n.raw_speech !== n.note && (
                          <details className="mt-2">
                            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Original transcript</summary>
                            <p className="mt-1 text-sm text-gray-500 italic">&ldquo;{n.raw_speech}&rdquo;</p>
                          </details>
                        )}
                        <StatusFooter status={n.status} updatedBy={n.status_updated_by} updatedAt={n.status_updated_at}/>
                      </div>
                      <div className="flex-shrink-0">
                        <StatusPicker value={n.status} onChange={(s) => setStatus('timed', n.id, s)} />
                      </div>
                    </div>

                    {/* Screenshots */}
                    {n.screenshots.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                          Screenshots ({n.screenshots.length})
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {n.screenshots.map((shot, si) => {
                            const src = shot.image_data || shot.image_url
                            const shotUrl = shot.timestamp_seconds
                              ? loomTimestampUrl(shot.timestamp_seconds)
                              : noteUrl
                            return (
                              <div key={shot.id}
                                  className="border-2 border-gray-200 hover:border-amber-500 transition-colors cursor-pointer group relative overflow-hidden">
                                {src ? (
                                  <img
                                    src={src}
                                    alt={`Screenshot at ${shot.timestamp_label}`}
                                    className="w-full h-auto block"
                                    onClick={() => openLightbox(n.screenshots, si)}
                                  />
                                ) : (
                                  <div className="aspect-video bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
                                    (no image)
                                  </div>
                                )}
                                {shotUrl && (
                                  <a href={shotUrl} target="_blank" rel="noopener noreferrer"
                                     onClick={e => e.stopPropagation()}
                                     className="absolute bottom-2 left-2 bg-black bg-opacity-75 hover:bg-opacity-90 text-white text-xs font-bold px-2 py-1">
                                    ⏱ {shot.timestamp_label}
                                  </a>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Comments */}
                    <CommentThread
                      comments={itemComments}
                      open={openCommentFor === composerKey}
                      onToggleOpen={() => setOpenCommentFor(openCommentFor === composerKey ? null : composerKey)}
                      draft={openCommentFor === composerKey ? commentDraft : ''}
                      onDraftChange={setCommentDraft}
                      onSubmit={() => submitComment('timed', n.id)}
                      posting={postingComment}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}

      </div>

      {/* ── Lightbox ───────────────────────────────────────────────── */}
      {lbImage && (
        <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
             onClick={() => setLbImage(null)}>
          <div className="relative max-w-7xl w-full">
            <button onClick={() => setLbImage(null)}
              className="absolute top-3 right-4 text-gray-300 text-4xl font-bold hover:text-white z-10 w-12 h-12 flex items-center justify-center">×</button>
            {lbList.length > 1 && (
              <>
                <button onClick={e => { e.stopPropagation(); const ni=(lbIndex-1+lbList.length)%lbList.length; setLbIndex(ni); const s=lbList[ni]; setLbImage(s.image_data||s.image_url); setLbLabel(s.timestamp_label) }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white text-5xl font-bold hover:text-gray-300 z-10 w-14 h-14 flex items-center justify-center">‹</button>
                <button onClick={e => { e.stopPropagation(); const ni=(lbIndex+1)%lbList.length; setLbIndex(ni); const s=lbList[ni]; setLbImage(s.image_data||s.image_url); setLbLabel(s.timestamp_label) }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white text-5xl font-bold hover:text-gray-300 z-10 w-14 h-14 flex items-center justify-center">›</button>
              </>
            )}
            <div className="bg-white p-2" onClick={e => e.stopPropagation()}>
              <img src={lbImage} alt={`Screenshot at ${lbLabel}`} className="w-full h-auto max-h-[85vh] object-contain"/>
              <p className="text-center mt-2 text-gray-700 font-semibold text-sm py-1">
                ⏱ {lbLabel}
                {lbList.length > 1 && <span className="ml-2 text-gray-400">({lbIndex+1}/{lbList.length})</span>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Name prompt modal ──────────────────────────────────────── */}
      {showNamePrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-2 border-amber-300 p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Who are you?</h2>
            <p className="text-sm text-gray-600 mb-4">Your name will appear on status changes and comments. Stored locally on your device — no account needed.</p>
            <select
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              disabled={usersLoading}
              autoFocus
              className="w-full border-2 border-gray-300 px-3 py-2 mb-3 text-gray-900 bg-white focus:outline-none focus:border-amber-500 disabled:bg-gray-50"
            >
              <option value="">{usersLoading ? 'Loading editors…' : '— select your name —'}</option>
              {userOptions.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              {userName && (
                <button onClick={() => { setShowNamePrompt(false); setNameDraft('') }}
                  className="px-4 py-2 text-sm font-semibold border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
              )}
              <button onClick={saveName}
                disabled={!nameDraft.trim()}
                className="px-4 py-2 text-sm font-semibold bg-amber-500 text-black border-2 border-amber-600 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:border-gray-300 disabled:cursor-not-allowed">Continue</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────

function StatusFooter({ status, updatedBy, updatedAt }:
  { status: Status; updatedBy: string | null; updatedAt: string | null }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 border ${STATUS_CHIP[status]} font-semibold`}>
        <span className={`inline-block w-2 h-2 ${STATUS_DOT[status]}`} />
        {STATUS_LABEL[status]}
      </span>
      {updatedBy && (
        <span>by <span className="font-semibold text-gray-700">{updatedBy}</span>{updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ''}</span>
      )}
    </div>
  )
}

function StatusPicker({ value, onChange }:
  { value: Status; onChange: (s: Status) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value as Status)}
        className={`text-sm font-semibold border-2 px-3 py-1.5 focus:outline-none cursor-pointer ${STATUS_CHIP[value]}`}
      >
        {STATUS_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function CommentThread({
  comments, open, onToggleOpen, draft, onDraftChange, onSubmit, posting,
}: {
  comments: Comment[]
  open: boolean
  onToggleOpen: () => void
  draft: string
  onDraftChange: (s: string) => void
  onSubmit: () => void
  posting: boolean
}) {
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          💬 Comments ({comments.length})
        </p>
        <button onClick={onToggleOpen}
          className="text-xs font-semibold text-indigo-700 hover:underline">
          {open ? 'Cancel' : '+ Add comment'}
        </button>
      </div>
      {comments.length > 0 && (
        <ul className="space-y-2 mb-2">
          {comments.map(c => (
            <li key={c.id} className="bg-gray-50 border border-gray-200 px-3 py-2">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-bold text-gray-800">{c.user_name}</span>
                <span className="text-[10px] text-gray-400">{new Date(c.created_at).toLocaleString()}</span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-line">{c.comment}</p>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={e => onDraftChange(e.target.value)}
            rows={2}
            placeholder="Add a comment — e.g. 'Fixed in v2', 'Need updated asset', 'Blocked: waiting on copy'…"
            className="w-full border-2 border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-amber-500"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={onSubmit} disabled={posting || !draft.trim()}
              className="px-4 py-1.5 text-sm font-semibold bg-amber-500 text-black border-2 border-amber-600 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:border-gray-300 disabled:cursor-not-allowed">
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
