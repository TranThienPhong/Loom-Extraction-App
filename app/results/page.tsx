'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getProcessingResults } from '@/lib/imageStorage'

function generateLoomUrlWithTimestamp(videoId: string, timestampSeconds: number): string {
  return `https://www.loom.com/share/${videoId}?t=${timestampSeconds}`
}

interface Screenshot {
  timestamp_seconds: number
  timestamp_label: string
  image_url: string
  image_base64?: string
}

interface Task {
  _id: string
  timestamp_seconds: number
  timestamp_label: string
  task_name: string
  task_description: string
  image_url: string
  image_base64?: string
  screenshots?: Screenshot[]
  loom_url: string
}

export default function Results() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [videoId, setVideoId] = useState('')
  const [summary, setSummary] = useState('')
  const [editingSummary, setEditingSummary] = useState(false)
  const [editedSummary, setEditedSummary] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [lightboxTimestamp, setLightboxTimestamp] = useState<string>('')
  const [lightboxIndex, setLightboxIndex] = useState<number>(0)
  const [currentTaskScreenshots, setCurrentTaskScreenshots] = useState<Screenshot[]>([])
  const router = useRouter()

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!lightboxImage) return
      if (e.key === 'Escape') { setLightboxImage(null); return }
      if (currentTaskScreenshots.length <= 1) return
      if (e.key === 'ArrowLeft') {
        const ni = (lightboxIndex - 1 + currentTaskScreenshots.length) % currentTaskScreenshots.length
        setLightboxIndex(ni)
        const s = currentTaskScreenshots[ni]
        setLightboxImage(s.image_base64 || s.image_url)
        setLightboxTimestamp(s.timestamp_label)
      } else if (e.key === 'ArrowRight') {
        const ni = (lightboxIndex + 1) % currentTaskScreenshots.length
        setLightboxIndex(ni)
        const s = currentTaskScreenshots[ni]
        setLightboxImage(s.image_base64 || s.image_url)
        setLightboxTimestamp(s.timestamp_label)
      }
    }
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [lightboxImage, lightboxIndex, currentTaskScreenshots])

  useEffect(() => {
    const loadResults = async () => {
      let loadedTasks: any[] = []
      let loadedVideoId = ''
      let loadedSummary = ''

      try {
        const raw = sessionStorage.getItem('loomResults')
        if (raw) {
          const data = JSON.parse(raw)
          if (data.tasks?.length > 0) {
            loadedTasks = data.tasks
            loadedVideoId = data.videoId || ''
            loadedSummary = data.summary || ''
          }
        }
      } catch {}

      if (loadedTasks.length === 0 || !loadedTasks[0]?.screenshots?.[0]?.image_base64) {
        try {
          const idb = await getProcessingResults()
          if (idb?.tasks?.length > 0) {
            loadedTasks = idb.tasks
            loadedVideoId = idb.videoId || ''
            loadedSummary = (idb as any).summary || ''
          }
        } catch {}
      }

      if (loadedTasks.length === 0) {
        alert('No results found. Please try processing the video again.')
        router.push('/')
        return
      }

      const tasksWithIds: Task[] = loadedTasks.map((t: any, i: number) => ({
        ...t,
        _id: t._id ?? String(i),
      }))

      setTasks(tasksWithIds)
      setVideoId(loadedVideoId)
      setSummary(loadedSummary)
    }

    loadResults()
  }, [router])

  const startEdit = (task: Task) => {
    setEditingTaskId(task._id)
    setEditTitle(task.task_name)
    setEditDescription(task.task_description)
  }

  const saveEdit = (id: string) => {
    setTasks(prev =>
      prev.map(t =>
        t._id === id
          ? { ...t, task_name: editTitle.trim() || t.task_name, task_description: editDescription.trim() || t.task_description }
          : t
      )
    )
    setEditingTaskId(null)
  }

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t._id !== id))
    setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  const deleteSelected = () => {
    setTasks(prev => prev.filter(t => !selectedIds.has(t._id)))
    setSelectedIds(new Set())
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.size === tasks.length ? new Set() : new Set(tasks.map(t => t._id)))
  }

  const handleExportPDF = async () => {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210
    const marginL = 15
    const contentW = pageW - marginL * 2
    let y = 20

    const checkY = (needed: number) => {
      if (y + needed > 278) { doc.addPage(); y = 20 }
    }

    doc.setFontSize(22)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 30, 30)
    doc.text('Loom Video – Extracted Tasks', marginL, y)
    y += 10

    if (summary) {
      checkY(22)
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(60, 80, 140)
      doc.text('Summary', marginL, y)
      y += 6
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(50, 50, 50)
      doc.setFontSize(10)
      const summaryLines = doc.splitTextToSize(summary, contentW)
      doc.text(summaryLines, marginL, y)
      y += summaryLines.length * 5 + 6
      doc.setDrawColor(200, 200, 220)
      doc.line(marginL, y, pageW - marginL, y)
      y += 8
    }

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]

      checkY(20)
      doc.setFontSize(13)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 20, 20)
      const titleLines = doc.splitTextToSize(`${i + 1}. ${task.task_name}`, contentW - 30)
      doc.text(titleLines, marginL, y)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(80, 100, 180)
      doc.text(`⏱ ${task.timestamp_label}`, pageW - marginL, y, { align: 'right' })
      y += titleLines.length * 6 + 2

      checkY(12)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60, 60, 60)
      const descLines = doc.splitTextToSize(task.task_description, contentW)
      doc.text(descLines, marginL, y)
      y += descLines.length * 5 + 4

      const shots = task.screenshots?.length
        ? task.screenshots
        : (task.image_base64 || task.image_url)
          ? [{ image_url: task.image_url || '', image_base64: task.image_base64, timestamp_label: task.timestamp_label, timestamp_seconds: task.timestamp_seconds }]
          : []

      if (shots.length > 0) {
        const imgW = contentW
        const imgH = Math.round(imgW * 9 / 16)

        for (let s = 0; s < shots.length; s++) {
          const shot = shots[s]
          const imgSrc = shot.image_base64 || shot.image_url
          if (!imgSrc) continue

          checkY(imgH + 14)

          if (shots.length > 1) {
            doc.setFontSize(8)
            doc.setTextColor(120, 120, 120)
            doc.text(`Screenshot ${s + 1}/${shots.length} — ${shot.timestamp_label}`, marginL, y)
            y += 4
          }

          try {
            let base64Data: string | null = null
            if (imgSrc.startsWith('data:')) {
              base64Data = imgSrc
            } else {
              try {
                const resp = await fetch(imgSrc)
                const blob = await resp.blob()
                base64Data = await new Promise<string>(resolve => {
                  const reader = new FileReader()
                  reader.onload = () => resolve(reader.result as string)
                  reader.readAsDataURL(blob)
                })
              } catch {
                base64Data = null
              }
            }
            if (!base64Data) throw new Error('No image data')

            // Decode via canvas to avoid jsPDF format/EXIF corruption (noise artifact)
            const pdfImgData: string = await new Promise((resolve, reject) => {
              const img = new window.Image()
              img.onload = () => {
                const canvas = document.createElement('canvas')
                const scale = 2 // 2× resolution for reasonable PDF quality
                canvas.width = Math.round(imgW * scale * 3.7795)
                canvas.height = Math.round(imgH * scale * 3.7795)
                const ctx = canvas.getContext('2d')
                if (!ctx) { reject(new Error('canvas context unavailable')); return }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                resolve(canvas.toDataURL('image/jpeg', 0.88))
              }
              img.onerror = () => reject(new Error('image load failed'))
              img.src = base64Data!
            })
            doc.addImage(pdfImgData, 'JPEG', marginL, y, imgW, imgH)
            const loomUrl = shot.timestamp_seconds
              ? generateLoomUrlWithTimestamp(videoId, shot.timestamp_seconds)
              : task.loom_url
            doc.link(marginL, y, imgW, imgH, { url: loomUrl })
            y += imgH + 2
            doc.setFontSize(8)
            doc.setTextColor(40, 80, 180)
            doc.textWithLink('▶ View in Loom', marginL, y, { url: loomUrl })
            y += 6
          } catch {
            doc.setFontSize(9)
            doc.setTextColor(40, 80, 180)
            doc.textWithLink('▶ View in Loom', marginL, y, { url: task.loom_url })
            y += 6
          }
        }
      } else {
        doc.setFontSize(9)
        doc.setTextColor(40, 80, 180)
        doc.textWithLink('▶ View in Loom', marginL, y, { url: task.loom_url })
        y += 6
      }

      y += 4
      doc.setDrawColor(220, 220, 220)
      doc.line(marginL, y, pageW - marginL, y)
      y += 6
    }

    doc.save('loom-tasks.pdf')
  }

  if (tasks.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">Loading results...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap justify-between items-start gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Extracted Tasks</h1>
            <p className="text-gray-500 mt-1">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={toggleSelectAll}
                  className="px-4 py-2 text-sm text-black font-semibold border-2 border-gray-300 bg-white hover:bg-gray-50 transition-colors"
                >
                  {selectedIds.size === tasks.length ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  onClick={deleteSelected}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold border-2 border-red-500 bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                  Delete ({selectedIds.size})
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="px-4 py-2 text-sm text-black font-semibold border-2 border-gray-300 bg-white hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
            <button
              onClick={handleExportPDF}
              className="bg-green-600 text-white px-5 py-2 font-semibold hover:bg-green-700 transition-colors border-2 border-green-700"
            >
              📄 Export PDF
            </button>
            <button
              onClick={() => router.push('/')}
              className="bg-gray-200 text-gray-700 px-5 py-2 font-semibold hover:bg-gray-300 transition-colors border-2 border-gray-300"
            >
              ← New Video
            </button>
          </div>
        </div>

        {/* Summary */}
        {summary && (
          <div className="bg-indigo-50 border-2 border-indigo-200 p-5 mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-indigo-800">📋 Video Summary</h2>
              {!editingSummary && (
                <button
                  onClick={() => { setEditingSummary(true); setEditedSummary(summary) }}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-semibold"
                >
                  ✏ Edit
                </button>
              )}
            </div>
            {editingSummary ? (
              <div>
                <textarea
                  value={editedSummary}
                  onChange={e => setEditedSummary(e.target.value)}
                  className="w-full border-2 border-indigo-300 p-3 text-gray-800 text-sm resize-none focus:outline-none focus:border-indigo-500"
                  rows={4}
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => { setSummary(editedSummary.trim()); setEditingSummary(false) }}
                    className="px-4 py-1.5 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingSummary(false)}
                    className="px-4 py-1.5 text-sm text-black font-semibold border border-gray-300 bg-white hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-gray-700 leading-relaxed">{summary}</p>
            )}
          </div>
        )}

        {/* Task list */}
        <div className="space-y-5">
          {tasks.map((task, displayIndex) => (
            <div
              key={task._id}
              className={`bg-white shadow-md overflow-hidden transition-shadow border-2 ${
                selectedIds.has(task._id)
                  ? 'border-red-400 shadow-red-100 shadow-lg'
                  : 'border-gray-200 hover:shadow-xl'
              }`}
            >
              <div className="p-6">
                <div className="flex items-start gap-3 mb-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(task._id)}
                    onChange={() => toggleSelect(task._id)}
                    className="mt-1.5 w-5 h-5 accent-red-500 cursor-pointer flex-shrink-0"
                  />

                  <div className="flex-1 min-w-0">
                    {editingTaskId === task._id ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          className="w-full border-2 border-indigo-400 px-3 py-2 text-lg font-bold text-gray-900 focus:outline-none focus:border-indigo-600"
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(task._id); if (e.key === 'Escape') setEditingTaskId(null) }}
                        />
                        <textarea
                          value={editDescription}
                          onChange={e => setEditDescription(e.target.value)}
                          className="w-full border-2 border-indigo-300 px-3 py-2 text-gray-700 resize-none focus:outline-none focus:border-indigo-500"
                          rows={3}
                          onKeyDown={e => { if (e.key === 'Escape') setEditingTaskId(null) }}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(task._id)}
                            className="px-4 py-1.5 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
                          >
                            ✓ Save
                          </button>
                          <button
                            onClick={() => setEditingTaskId(null)}
                            className="px-4 py-1.5 text-sm text-black font-semibold border border-gray-300 bg-white hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h2 className="text-xl font-bold text-gray-900">
                            {displayIndex + 1}. {task.task_name}
                          </h2>
                          <span className="inline-block bg-indigo-100 text-indigo-800 text-sm font-semibold px-3 py-1 border border-indigo-300">
                            ⏱ {task.timestamp_label}
                          </span>
                        </div>
                        <p className="text-gray-700 leading-relaxed">{task.task_description}</p>
                      </>
                    )}
                  </div>

                  {editingTaskId !== task._id && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => startEdit(task)}
                        title="Edit task"
                        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 border border-gray-200 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteTask(task._id)}
                        title="Delete task"
                        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 border border-gray-200 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Screenshots */}
                {task.screenshots && task.screenshots.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Screenshots ({task.screenshots.length})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {task.screenshots.map((screenshot, si) => (
                        <div
                          key={si}
                          className="border-2 border-gray-200 hover:border-indigo-500 transition-colors cursor-pointer group relative overflow-hidden"
                        >
                          <img
                            src={screenshot.image_base64 || screenshot.image_url}
                            alt={`Screenshot at ${screenshot.timestamp_label}`}
                            className="w-full h-auto block"
                            onClick={() => {
                              setCurrentTaskScreenshots(task.screenshots || [])
                              setLightboxIndex(si)
                              setLightboxImage(screenshot.image_base64 || screenshot.image_url)
                              setLightboxTimestamp(screenshot.timestamp_label)
                            }}
                            onError={e => {
                              if (screenshot.image_base64 && e.currentTarget.src !== screenshot.image_base64) {
                                e.currentTarget.src = screenshot.image_base64
                              }
                            }}
                          />
                          <a
                            href={screenshot.timestamp_seconds
                              ? generateLoomUrlWithTimestamp(videoId, screenshot.timestamp_seconds)
                              : task.loom_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="absolute bottom-2 left-2 bg-black bg-opacity-75 hover:bg-opacity-90 text-white text-xs font-bold px-2 py-1 rounded shadow z-10"
                          >
                            ⏱ {screenshot.timestamp_label}
                          </a>
                          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-25 transition-all flex items-center justify-center pointer-events-none">
                            <span className="text-white font-semibold text-sm opacity-0 group-hover:opacity-100 transition-opacity drop-shadow">
                              🔍 Enlarge
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (task.image_base64 || task.image_url) ? (
                  <div className="mt-4 border-2 border-gray-200">
                    <img
                      src={task.image_base64 || task.image_url}
                      alt={`Screenshot at ${task.timestamp_label}`}
                      className="w-full h-auto"
                      onError={e => {
                        if (task.image_base64 && e.currentTarget.src !== task.image_base64) {
                          e.currentTarget.src = task.image_base64
                        }
                      }}
                    />
                  </div>
                ) : null}

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
          ))}
        </div>

        {tasks.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-2xl mb-3">No tasks remaining</p>
            <button onClick={() => router.push('/')} className="text-indigo-600 hover:underline font-semibold">
              ← Process another video
            </button>
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

            {currentTaskScreenshots.length > 1 && (
              <>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const ni = (lightboxIndex - 1 + currentTaskScreenshots.length) % currentTaskScreenshots.length
                    setLightboxIndex(ni)
                    const s = currentTaskScreenshots[ni]
                    setLightboxImage(s.image_base64 || s.image_url)
                    setLightboxTimestamp(s.timestamp_label)
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white text-5xl font-bold hover:text-gray-300 z-10 w-14 h-14 flex items-center justify-center"
                >
                  ‹
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const ni = (lightboxIndex + 1) % currentTaskScreenshots.length
                    setLightboxIndex(ni)
                    const s = currentTaskScreenshots[ni]
                    setLightboxImage(s.image_base64 || s.image_url)
                    setLightboxTimestamp(s.timestamp_label)
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
                alt={`Screenshot at ${lightboxTimestamp}`}
                className="w-full h-auto max-h-[85vh] object-contain"
              />
              <p className="text-center mt-2 text-gray-700 font-semibold text-sm py-1">
                ⏱ {lightboxTimestamp}
                {currentTaskScreenshots.length > 1 && (
                  <span className="ml-2 text-gray-400">({lightboxIndex + 1}/{currentTaskScreenshots.length})</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
