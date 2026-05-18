'use client'

import { useEffect, useState, useCallback, use } from 'react'

interface Screenshot {
  timestamp_seconds: number
  timestamp_label: string
  image_url: string
  image_base64?: string
}

interface TaskItem {
  _id: string
  task_name: string
  task_description: string
  loom_url: string
  timestamp_seconds: number
  timestamp_label: string
  priority?: number
  complexity?: string
  project?: string
  client?: string
  area?: string
  assignee?: string
  task_type?: string
  completed: boolean
  image_url?: string
  image_base64?: string
  screenshots?: Screenshot[]
}

interface TaskSession {
  id: string
  title: string
  summary: string
  loom_url: string
  video_id: string
  tasks: TaskItem[]
  transcript: { t: string; s: string }[]
  created_at: string
}

type FilterType = 'all' | 'pending' | 'completed'

async function patchSession(id: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/task-sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`PATCH failed: ${r.status}`)
}

export default function SharedTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [session, setSession] = useState<TaskSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')

  // Edit state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Summary edit
  const [editingSummary, setEditingSummary] = useState(false)
  const [editedSummary, setEditedSummary] = useState('')

  // Share modal
  const [showShareModal, setShowShareModal] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  // Lightbox
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [lightboxTimestamp, setLightboxTimestamp] = useState('')
  const [lightboxScreenshots, setLightboxScreenshots] = useState<Screenshot[]>([])
  const [lightboxIndex, setLightboxIndex] = useState(0)

  useEffect(() => {
    fetch(`/api/task-sessions/${id}`)
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
        setLightboxTimestamp(s.timestamp_label)
      } else if (e.key === 'ArrowRight') {
        const ni = (lightboxIndex + 1) % lightboxScreenshots.length
        setLightboxIndex(ni)
        const s = lightboxScreenshots[ni]
        setLightboxImage(s.image_base64 || s.image_url)
        setLightboxTimestamp(s.timestamp_label)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [lightboxImage, lightboxIndex, lightboxScreenshots])

  const loomTimestampUrl = useCallback((videoId: string, ts: number) =>
    `https://www.loom.com/share/${videoId}?t=${ts}`, [])

  const openLightbox = (screenshots: Screenshot[], index: number) => {
    const s = screenshots[index]
    setLightboxScreenshots(screenshots)
    setLightboxIndex(index)
    setLightboxImage(s.image_base64 || s.image_url)
    setLightboxTimestamp(s.timestamp_label)
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  const toggleTask = async (taskId: string, current: boolean) => {
    if (!session) return
    setSaving(taskId)
    const newVal = !current
    setSession(prev => prev
      ? { ...prev, tasks: prev.tasks.map(t => t._id === taskId ? { ...t, completed: newVal } : t) }
      : prev)
    try {
      await patchSession(id, { op: 'complete', taskId, completed: newVal })
    } catch {
      setSession(prev => prev
        ? { ...prev, tasks: prev.tasks.map(t => t._id === taskId ? { ...t, completed: current } : t) }
        : prev)
    } finally { setSaving(null) }
  }

  const startEdit = (task: TaskItem) => {
    setEditingTaskId(task._id)
    setEditTitle(task.task_name)
    setEditDescription(task.task_description)
  }

  const saveEdit = async (taskId: string) => {
    const prevTask = session?.tasks.find(t => t._id === taskId)
    const prevName = prevTask?.task_name ?? ''
    const prevDesc = prevTask?.task_description ?? ''
    const newName = editTitle.trim() || prevName
    const newDesc = editDescription.trim() || prevDesc
    setEditingTaskId(null)
    setSession(prev => prev
      ? { ...prev, tasks: prev.tasks.map(t => t._id === taskId ? { ...t, task_name: newName, task_description: newDesc } : t) }
      : prev)
    try {
      await patchSession(id, { op: 'edit', taskId, task_name: newName, task_description: newDesc })
    } catch {
      setSession(prev => prev
        ? { ...prev, tasks: prev.tasks.map(t => t._id === taskId ? { ...t, task_name: prevName, task_description: prevDesc } : t) }
        : prev)
    }
  }

  const deleteTask = async (taskId: string) => {
    const snapshot = session?.tasks ?? []
    setSession(prev => prev ? { ...prev, tasks: prev.tasks.filter(t => t._id !== taskId) } : prev)
    try {
      await patchSession(id, { op: 'delete', taskId })
    } catch {
      setSession(prev => prev ? { ...prev, tasks: snapshot } : prev)
    }
  }

  const updateType = async (taskId: string, task_type: string) => {
    setSession(prev => prev
      ? { ...prev, tasks: prev.tasks.map(t => t._id === taskId ? { ...t, task_type } : t) }
      : prev)
    try {
      await patchSession(id, { op: 'type', taskId, task_type })
    } catch {}
  }

  const saveSummary = async () => {
    const prevSummary = session?.summary ?? ''
    const next = editedSummary.trim()
    setEditingSummary(false)
    setSession(prev => prev ? { ...prev, summary: next } : prev)
    try {
      await patchSession(id, { op: 'summary', summary: next })
    } catch {
      setSession(prev => prev ? { ...prev, summary: prevSummary } : prev)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">Loading task session…</p>
        </div>
      </div>
    )
  }

  if (notFound || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Session not found</h1>
          <p className="text-gray-600 mb-6">This task session does not exist or may have been removed.</p>
          <a href="/" className="bg-indigo-600 text-white px-6 py-2 font-semibold hover:bg-indigo-700 transition-colors border-2 border-indigo-700">
            ← Go Home
          </a>
        </div>
      </div>
    )
  }

  const { tasks, summary, transcript, created_at, video_id } = session
  const completedCount = tasks.filter(t => t.completed).length
  const pendingCount = tasks.filter(t => !t.completed).length

  const visibleTasks = tasks.filter(t => {
    if (filter === 'pending') return !t.completed
    if (filter === 'completed') return t.completed
    return true
  })

  const shareUrl = typeof window !== 'undefined' ? window.location.href : `${process.env.NEXT_PUBLIC_SITE_URL || ''}/tasks/${id}`

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap justify-between items-start gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Extracted Tasks</h1>
            <p className="text-gray-500 mt-1">
              {tasks.length} task{tasks.length !== 1 ? 's' : ''}
              <span className="ml-2 text-gray-400 text-xs">· {new Date(created_at).toLocaleDateString()} · ID: {id}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowShareModal(true)}
              className="bg-blue-600 text-white px-5 py-2 font-semibold hover:bg-blue-700 transition-colors border-2 border-blue-700"
            >
              🔗 Share Link
            </button>
            {session.loom_url && (
              <a href={session.loom_url} target="_blank" rel="noreferrer"
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
        <div className="bg-indigo-50 border-2 border-indigo-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-indigo-800">📋 Progress</h2>
            <div className="text-right">
              <span className="text-3xl font-bold text-indigo-600">{completedCount}</span>
              <span className="text-gray-400 text-xl">/{tasks.length}</span>
              <div className="text-xs text-gray-500 mt-0.5">completed</div>
            </div>
          </div>
          <div className="w-full bg-indigo-100 h-2 mb-3">
            <div
              className="bg-indigo-600 h-2 transition-all duration-300"
              style={{ width: tasks.length > 0 ? `${(completedCount / tasks.length) * 100}%` : '0%' }}
            />
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-gray-600"><span className="font-semibold text-green-700">{completedCount}</span> done</span>
            <span className="text-gray-600"><span className="font-semibold text-red-600">{pendingCount}</span> pending</span>
          </div>
        </div>

        {/* Summary */}
        {(summary || editingSummary) && (
          <div className="bg-indigo-50 border-2 border-indigo-200 p-5 mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-indigo-800">📋 Video Summary</h2>
              {!editingSummary && (
                <button onClick={() => { setEditingSummary(true); setEditedSummary(summary) }}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-semibold">✏ Edit</button>
              )}
            </div>
            {editingSummary ? (
              <div>
                <textarea value={editedSummary} onChange={e => setEditedSummary(e.target.value)}
                  className="w-full border-2 border-indigo-300 p-3 text-gray-800 text-sm resize-none focus:outline-none focus:border-indigo-500" rows={4} autoFocus />
                <div className="flex gap-2 mt-2">
                  <button onClick={saveSummary} className="px-4 py-1.5 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
                  <button onClick={() => setEditingSummary(false)} className="px-4 py-1.5 text-sm text-black font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-gray-700 leading-relaxed">{summary}</p>
            )}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex border-b-2 border-gray-200 mb-6 bg-white">
          {(['all', 'pending', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                filter === f ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-gray-700 hover:text-gray-900'
              }`}
            >
              {f === 'all' ? `All (${tasks.length})` :
               f === 'pending' ? `Pending (${pendingCount})` :
               `Completed (${completedCount})`}
            </button>
          ))}
        </div>

        {/* Task list */}
        <div className="space-y-5">
          {visibleTasks.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-2xl mb-3">{filter === 'pending' ? 'All tasks done! 🎉' : 'No tasks.'}</p>
            </div>
          ) : visibleTasks.map((task, idx) => {
            const screenshots = task.screenshots?.length
              ? task.screenshots
              : (task.image_base64 || task.image_url)
                ? [{ timestamp_seconds: task.timestamp_seconds, timestamp_label: task.timestamp_label, image_url: task.image_url || '', image_base64: task.image_base64 }]
                : []

            return (
              <div
                key={task._id}
                className={`bg-white shadow-md overflow-hidden transition-shadow border-2 ${
                  task.completed ? 'border-green-300 opacity-80' : 'border-gray-200 hover:shadow-xl'
                }`}
              >
                <div className="p-6">
                  <div className="flex items-start gap-3 mb-3">
                    <button
                      onClick={() => toggleTask(task._id, task.completed)}
                      disabled={saving === task._id}
                      title={task.completed ? 'Mark pending' : 'Mark complete'}
                      className={`mt-1 w-5 h-5 flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                        task.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-indigo-500'
                      } ${saving === task._id ? 'opacity-50 cursor-wait' : ''}`}
                    >
                      {task.completed && <span className="text-xs">✓</span>}
                    </button>

                    <div className="flex-1 min-w-0">
                      {editingTaskId === task._id ? (
                        <div className="space-y-3">
                          <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)}
                            className="w-full border-2 border-indigo-400 px-3 py-2 text-lg font-bold text-gray-900 focus:outline-none focus:border-indigo-600"
                            autoFocus onKeyDown={e => { if (e.key === 'Enter') saveEdit(task._id); if (e.key === 'Escape') setEditingTaskId(null) }} />
                          <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)}
                            className="w-full border-2 border-indigo-300 px-3 py-2 text-gray-700 resize-none focus:outline-none focus:border-indigo-500" rows={3}
                            onKeyDown={e => { if (e.key === 'Escape') setEditingTaskId(null) }} />
                          <div className="flex gap-2">
                            <button onClick={() => saveEdit(task._id)} className="px-4 py-1.5 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">✓ Save</button>
                            <button onClick={() => setEditingTaskId(null)} className="px-4 py-1.5 text-sm text-black font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h2 className={`text-xl font-bold ${task.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                              {idx + 1}. {task.task_name}
                            </h2>
                            <span className="inline-block bg-indigo-100 text-indigo-800 text-sm font-semibold px-3 py-1 border border-indigo-300">
                              ⏱ {task.timestamp_label}
                            </span>
                            <select
                              value={task.task_type || 'Nice-to-have'}
                              onChange={e => updateType(task._id, e.target.value)}
                              className={`text-xs font-semibold px-2 py-1 border-2 cursor-pointer focus:outline-none ${
                                (task.task_type || 'Nice-to-have') === 'Need-to-have'
                                  ? 'bg-red-50 border-red-300 text-red-700'
                                  : 'bg-gray-50 border-gray-300 text-gray-600'
                              }`}
                            >
                              <option value="Need-to-have">🔴 Need-to-have</option>
                              <option value="Nice-to-have">🟢 Nice-to-have</option>
                            </select>
                          </div>
                          <p className={`text-gray-700 leading-relaxed ${task.completed ? 'line-through text-gray-400' : ''}`}>
                            {task.task_description}
                          </p>
                          {(task.client || task.project || task.area || task.assignee) && (
                            <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                              {task.client && <span>👤 <strong>Client:</strong> {task.client}</span>}
                              {task.project && <span>📁 <strong>Project:</strong> {task.project}</span>}
                              {task.area && <span>🏷 <strong>Area:</strong> {task.area}</span>}
                              {task.assignee && <span>🙋 <strong>Assignee:</strong> {task.assignee}</span>}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {editingTaskId !== task._id && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => startEdit(task)} title="Edit"
                          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 border border-gray-200 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button onClick={() => deleteTask(task._id)} title="Delete"
                          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 border border-gray-200 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Screenshots */}
                  {screenshots.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Screenshots ({screenshots.length})
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {screenshots.map((s, si) => (
                          <div
                            key={si}
                            className="border-2 border-gray-200 hover:border-indigo-500 transition-colors cursor-pointer group relative overflow-hidden"
                          >
                            <img
                              src={s.image_base64 || s.image_url}
                              alt={`Screenshot at ${s.timestamp_label}`}
                              className="w-full h-auto block"
                              onClick={() => openLightbox(screenshots, si)}
                            />
                            <a
                              href={video_id
                                ? loomTimestampUrl(video_id, s.timestamp_seconds)
                                : task.loom_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="absolute bottom-2 left-2 bg-black bg-opacity-75 hover:bg-opacity-90 text-white text-xs font-bold px-2 py-1 rounded shadow z-10"
                            >
                              ⏱ {s.timestamp_label}
                            </a>
                            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-25 transition-all flex items-center justify-center pointer-events-none">
                              <span className="text-white font-semibold text-sm opacity-0 group-hover:opacity-100 transition-opacity drop-shadow">🔍 Enlarge</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <a
                      href={task.loom_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block bg-indigo-600 text-white px-5 py-2.5 font-semibold hover:bg-indigo-700 transition-colors border-2 border-indigo-700 text-sm"
                    >
                      Watch in Loom
                    </a>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

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
            >×</button>

            {lightboxScreenshots.length > 1 && (
              <>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const ni = (lightboxIndex - 1 + lightboxScreenshots.length) % lightboxScreenshots.length
                    setLightboxIndex(ni)
                    const s = lightboxScreenshots[ni]
                    setLightboxImage(s.image_base64 || s.image_url)
                    setLightboxTimestamp(s.timestamp_label)
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white text-5xl font-bold hover:text-gray-300 z-10 w-14 h-14 flex items-center justify-center"
                >‹</button>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const ni = (lightboxIndex + 1) % lightboxScreenshots.length
                    setLightboxIndex(ni)
                    const s = lightboxScreenshots[ni]
                    setLightboxImage(s.image_base64 || s.image_url)
                    setLightboxTimestamp(s.timestamp_label)
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white text-5xl font-bold hover:text-gray-300 z-10 w-14 h-14 flex items-center justify-center"
                >›</button>
              </>
            )}

            <div className="bg-white p-2" onClick={e => e.stopPropagation()}>
              <img
                src={lightboxImage}
                alt={`Screenshot at ${lightboxTimestamp}`}
                className="w-full h-auto max-h-[85vh] object-contain"
              />
              <p className="text-center mt-2 text-gray-700 font-semibold text-sm py-1">
                ⏱ {lightboxTimestamp}
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
                <h2 className="text-2xl font-bold text-gray-900">🔗 Share This Session</h2>
                <p className="text-gray-600 mt-1 text-sm">Anyone with this link can view and check off tasks.</p>
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
