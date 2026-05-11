'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

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
  note: string
  raw_speech?: string
  completed: boolean
  loom_url?: string
  screenshots?: RevisionScreenshot[]
}

type FilterType = 'all' | 'pending' | 'completed' | 'global'

export default function RevisionPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [videoId, setVideoId] = useState('')
  const [loomUrl, setLoomUrl] = useState('')
  const [globalNotes, setGlobalNotes] = useState<GlobalNote[]>([])
  const [revisionNotes, setRevisionNotes] = useState<RevisionNote[]>([])
  const [transcript, setTranscript] = useState<{ t: string; s: string }[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [lightboxLabel, setLightboxLabel] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('revisionResults')
      if (!raw) {
        alert('No revision results found. Please process a video first.')
        router.push('/')
        return
      }
      const data = JSON.parse(raw)
      setTitle(data.title || 'Revision Notes')
      setSummary(data.summary || '')
      setVideoId(data.videoId || '')
      setLoomUrl(data.loomUrl || '')
      setGlobalNotes(
        (data.global_notes || []).map((n: any, i: number) => ({
          ...n,
          id: n.id ?? `g-${i}`,
        }))
      )
      setRevisionNotes(
        (data.revision_notes || []).map((n: any, i: number) => ({
          ...n,
          id: n.id ?? `r-${i}`,
        }))
      )
      setTranscript(data.transcript || [])
    } catch {
      router.push('/')
    }
  }, [router])

  // ── helpers ────────────────────────────────────────────────────────────
  const toggleGlobal = (id: string) => {
    setGlobalNotes(prev => prev.map(n => n.id === id ? { ...n, completed: !n.completed } : n))
  }
  const deleteGlobal = (id: string) => {
    setGlobalNotes(prev => prev.filter(n => n.id !== id))
  }

  const toggleRevision = (id: string) => {
    setRevisionNotes(prev => prev.map(n => n.id === id ? { ...n, completed: !n.completed } : n))
  }
  const deleteRevision = (id: string) => {
    setRevisionNotes(prev => prev.filter(n => n.id !== id))
  }

  const startEdit = (id: string, currentNote: string) => {
    setEditingId(id)
    setEditText(currentNote)
  }
  const saveEdit = (id: string) => {
    if (id.startsWith('g-')) {
      setGlobalNotes(prev => prev.map(n => n.id === id ? { ...n, note: editText.trim() || n.note } : n))
    } else {
      setRevisionNotes(prev => prev.map(n => n.id === id ? { ...n, note: editText.trim() || n.note } : n))
    }
    setEditingId(null)
  }

  const markAllComplete = () => {
    setGlobalNotes(prev => prev.map(n => ({ ...n, completed: true })))
    setRevisionNotes(prev => prev.map(n => ({ ...n, completed: true })))
  }
  const markAllPending = () => {
    setGlobalNotes(prev => prev.map(n => ({ ...n, completed: false })))
    setRevisionNotes(prev => prev.map(n => ({ ...n, completed: false })))
  }

  const pendingCount = revisionNotes.filter(n => !n.completed).length + globalNotes.filter(n => !n.completed).length
  const completedCount = revisionNotes.filter(n => n.completed).length + globalNotes.filter(n => n.completed).length
  const totalCount = globalNotes.length + revisionNotes.length

  // Filtered notes
  const visibleRevisionNotes = revisionNotes.filter(n => {
    if (filter === 'pending') return !n.completed
    if (filter === 'completed') return n.completed
    if (filter === 'global') return false
    return true
  })
  const showGlobalSection = filter === 'all' || filter === 'global'

  // ── PDF export ──────────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210
    const pageH = 297
    const mL = 15
    const mR = 15
    const cW = pageW - mL - mR
    let y = 20

    const addPage = () => { doc.addPage(); y = 20 }
    const checkPage = (needed: number) => { if (y + needed > pageH - 20) addPage() }

    const hr = (yPos: number) => {
      doc.setDrawColor(200, 200, 210)
      doc.setLineWidth(0.2)
      doc.line(mL, yPos, pageW - mR, yPos)
    }

    // Cover
    doc.setFontSize(22)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 30, 100)
    const titleLines = doc.splitTextToSize(title, cW)
    doc.text(titleLines, mL, y)
    y += titleLines.length * 9 + 4

    doc.setDrawColor(60, 90, 220)
    doc.setLineWidth(0.8)
    doc.line(mL, y, pageW - mR, y)
    doc.setLineWidth(0.2)
    y += 8

    if (loomUrl) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(30, 70, 200)
      doc.textWithLink(`Loom Source: ${loomUrl}`, mL, y, { url: loomUrl })
      y += 6
    }

    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 80, 100)
    doc.text(
      `Generated: ${new Date().toLocaleDateString()}  •  ${globalNotes.length} global notes  •  ${revisionNotes.length} revision notes`,
      mL,
      y
    )
    y += 8

    if (summary) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(50, 50, 70)
      const sumLines = doc.splitTextToSize(summary, cW)
      doc.text(sumLines, mL, y)
      y += sumLines.length * 5 + 6
    }

    hr(y); y += 8

    // Global Notes
    if (globalNotes.length > 0) {
      checkPage(20)
      doc.setFontSize(13)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 30, 100)
      doc.text('Global Notes', mL, y)
      y += 7

      globalNotes.forEach((note, i) => {
        checkPage(16)
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(note.completed ? 130 : 30, note.completed ? 160 : 30, note.completed ? 130 : 30)
        const prefix = note.completed ? '☑' : '☐'
        const lines = doc.splitTextToSize(`${prefix}  ${i + 1}. ${note.note}`, cW - 4)
        checkPage(lines.length * 5 + 4)
        doc.text(lines, mL + 2, y)
        y += lines.length * 5 + 3
      })
      y += 4
    }

    hr(y); y += 8

    // Timestamped Revision Notes
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 30, 100)
    doc.text('Timestamped Revision Notes', mL, y)
    y += 7

    for (let i = 0; i < revisionNotes.length; i++) {
      const note = revisionNotes[i]

      checkPage(30)

      // Note header band
      doc.setFillColor(note.completed ? 240 : 235, note.completed ? 248 : 238, note.completed ? 240 : 255)
      doc.rect(mL, y - 3, cW, 12, 'F')

      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(note.completed ? 100 : 30, note.completed ? 130 : 50, note.completed ? 100 : 180)
      doc.text(`${note.completed ? '☑' : '☐'}  ${note.timestamp_label}`, mL + 2, y + 4)

      if (note.loom_url) {
        doc.setTextColor(30, 70, 200)
        doc.textWithLink('→ Jump to timestamp', pageW - mR - 35, y + 4, { url: note.loom_url })
      }
      y += 12

      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(note.completed ? 100 : 20, note.completed ? 100 : 20, note.completed ? 100 : 20)
      const noteLines = doc.splitTextToSize(note.note, cW - 4)
      checkPage(noteLines.length * 5 + 4)
      doc.text(noteLines, mL + 2, y)
      y += noteLines.length * 5 + 3

      if (note.raw_speech && note.raw_speech !== note.note) {
        doc.setFontSize(8)
        doc.setFont('helvetica', 'italic')
        doc.setTextColor(130, 130, 130)
        const rawLines = doc.splitTextToSize(`Original: "${note.raw_speech}"`, cW - 8)
        checkPage(rawLines.length * 4 + 4)
        doc.text(rawLines, mL + 4, y)
        y += rawLines.length * 4 + 3
      }

      // Screenshot
      const shot = note.screenshots?.[0]
      if (shot) {
        const imgSrc = shot.image_base64 || shot.image_url
        if (imgSrc) {
          const imgW = 80
          const imgH = Math.round(imgW * 9 / 16)
          checkPage(imgH + 10)
          try {
            doc.addImage(imgSrc, 'JPEG', mL + 2, y, imgW, imgH)
            y += imgH + 4
          } catch {}
        }
      }

      y += 4
      hr(y); y += 6
    }

    doc.save(`revision-notes-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  // ── Markdown export ─────────────────────────────────────────────────────
  const handleExportMarkdown = () => {
    const lines: string[] = [
      `# ${title}`,
      '',
      `**Generated:** ${new Date().toLocaleDateString()}  |  **Source:** ${loomUrl || '—'}`,
      '',
    ]
    if (summary) {
      lines.push(`> ${summary}`, '')
    }
    lines.push(`---`, '', `**${globalNotes.length}** global notes · **${revisionNotes.length}** timestamped revisions`, '', `---`, '')

    if (globalNotes.length > 0) {
      lines.push('## Global Notes', '')
      globalNotes.forEach((n, i) => {
        lines.push(`- [${n.completed ? 'x' : ' '}] **${i + 1}.** ${n.note}`)
      })
      lines.push('')
    }

    if (revisionNotes.length > 0) {
      lines.push('## Timestamped Revision Notes', '')
      revisionNotes.forEach((n, i) => {
        const link = n.loom_url ? ` ([↗ ${n.timestamp_label}](${n.loom_url}))` : ` (${n.timestamp_label})`
        lines.push(`### ${i + 1}. ${n.timestamp_label}${link}`)
        lines.push('')
        lines.push(`- [${n.completed ? 'x' : ' '}] ${n.note}`)
        if (n.raw_speech && n.raw_speech !== n.note) {
          lines.push(`  > *Original: "${n.raw_speech}"*`)
        }
        lines.push('')
      })
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `revision-notes-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push('/')}
              className="text-gray-500 hover:text-gray-800 flex-shrink-0"
              title="Back to home"
            >
              ← Back
            </button>
            <span className="text-gray-300">|</span>
            <span className="text-sm font-semibold text-amber-700 truncate">{title}</span>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleExportMarkdown}
              className="px-3 py-1.5 text-xs font-semibold border-2 border-gray-300 text-gray-700 hover:border-gray-400 transition-colors"
            >
              Export MD
            </button>
            <button
              onClick={handleExportPDF}
              className="px-3 py-1.5 text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
            >
              Export PDF
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white border border-gray-200 p-6 mb-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 border border-amber-200">
                  ✏️ REVISION NOTES
                </span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 leading-tight">{title}</h1>
              {summary && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{summary}</p>}
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="text-3xl font-bold text-amber-600">{completedCount}<span className="text-gray-300">/{totalCount}</span></div>
              <div className="text-xs text-gray-500 mt-0.5">completed</div>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-4 text-sm">
            <span className="text-gray-600">
              <span className="font-semibold text-indigo-700">{globalNotes.length}</span> global notes
            </span>
            <span className="text-gray-600">
              <span className="font-semibold text-amber-700">{revisionNotes.length}</span> timestamped revisions
            </span>
            <span className="text-gray-600">
              <span className="font-semibold text-green-700">{completedCount}</span> completed
            </span>
            <span className="text-gray-600">
              <span className="font-semibold text-red-600">{pendingCount}</span> pending
            </span>
            {loomUrl && (
              <a href={loomUrl} target="_blank" rel="noreferrer"
                className="ml-auto text-xs text-indigo-600 hover:underline font-medium">
                ↗ Open source video
              </a>
            )}
          </div>

          {/* Bulk actions */}
          <div className="mt-3 flex gap-2">
            <button onClick={markAllComplete}
              className="text-xs px-3 py-1 border border-green-300 text-green-700 hover:bg-green-50 transition-colors">
              ✓ Mark all complete
            </button>
            <button onClick={markAllPending}
              className="text-xs px-3 py-1 border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">
              ↺ Reset all
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-gray-200 mb-6 bg-white">
          {(['all', 'pending', 'completed', 'global'] as FilterType[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                filter === f
                  ? 'border-amber-500 text-amber-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {f === 'all' ? `All (${totalCount})` :
               f === 'pending' ? `Pending (${pendingCount})` :
               f === 'completed' ? `Completed (${completedCount})` :
               `Global Notes (${globalNotes.length})`}
            </button>
          ))}
        </div>

        {/* Global Notes */}
        {showGlobalSection && globalNotes.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <span className="w-3 h-3 bg-indigo-500 inline-block"></span>
              Global Notes
              <span className="text-xs font-normal text-gray-500 ml-1">— applies to the entire video</span>
            </h2>
            <div className="space-y-2">
              {globalNotes.map(note => (
                <div
                  key={note.id}
                  className={`bg-white border-l-4 p-4 shadow-sm ${
                    note.completed ? 'border-green-400 opacity-70' : 'border-indigo-400'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleGlobal(note.id)}
                      className={`mt-0.5 w-5 h-5 flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                        note.completed
                          ? 'bg-green-500 border-green-500 text-white'
                          : 'border-gray-300 hover:border-indigo-500'
                      }`}
                    >
                      {note.completed && <span className="text-xs">✓</span>}
                    </button>

                    <div className="flex-1 min-w-0">
                      {editingId === note.id ? (
                        <div className="flex gap-2">
                          <textarea
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            rows={2}
                            className="flex-1 text-sm border-2 border-indigo-300 px-2 py-1 focus:outline-none focus:border-indigo-500"
                          />
                          <div className="flex flex-col gap-1">
                            <button onClick={() => saveEdit(note.id)}
                              className="text-xs px-2 py-1 bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
                            <button onClick={() => setEditingId(null)}
                              className="text-xs px-2 py-1 border border-gray-300 text-gray-600 hover:bg-gray-50">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p className={`text-sm leading-relaxed ${note.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                          {note.note}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => startEdit(note.id, note.note)}
                        className="text-xs px-2 py-1 text-gray-400 hover:text-gray-700 border border-transparent hover:border-gray-300">
                        Edit
                      </button>
                      <button onClick={() => deleteGlobal(note.id)}
                        className="text-xs px-2 py-1 text-red-400 hover:text-red-600 border border-transparent hover:border-red-200">
                        ✕
                      </button>
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
            <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <span className="w-3 h-3 bg-amber-500 inline-block"></span>
              Timestamped Revision Notes
              {visibleRevisionNotes.length !== revisionNotes.length && (
                <span className="text-xs font-normal text-gray-500 ml-1">
                  — showing {visibleRevisionNotes.length} of {revisionNotes.length}
                </span>
              )}
            </h2>

            {visibleRevisionNotes.length === 0 ? (
              <div className="text-center py-12 bg-white border border-gray-200 text-gray-500 text-sm">
                {filter === 'pending' ? 'All revisions complete! 🎉' : 'No notes to show.'}
              </div>
            ) : (
              <div className="space-y-4">
                {visibleRevisionNotes.map((note, idx) => {
                  const shot = note.screenshots?.[0]
                  const shotSrc = shot?.image_base64 || shot?.image_url

                  return (
                    <div
                      key={note.id}
                      className={`bg-white border shadow-sm overflow-hidden ${
                        note.completed ? 'border-green-200 opacity-80' : 'border-gray-200'
                      }`}
                    >
                      {/* Note header */}
                      <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${
                        note.completed ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'
                      }`}>
                        <button
                          onClick={() => toggleRevision(note.id)}
                          className={`w-5 h-5 flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                            note.completed
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-gray-300 hover:border-amber-500'
                          }`}
                        >
                          {note.completed && <span className="text-xs">✓</span>}
                        </button>

                        <span className="text-xs font-mono font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 border border-indigo-100">
                          {note.timestamp_label}
                        </span>

                        {note.loom_url && (
                          <a
                            href={note.loom_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline font-medium"
                          >
                            ↗ Jump to video
                          </a>
                        )}

                        <span className="ml-auto text-xs text-gray-400">#{idx + 1}</span>

                        <div className="flex gap-1">
                          <button onClick={() => startEdit(note.id, note.note)}
                            className="text-xs px-2 py-1 text-gray-400 hover:text-gray-700 border border-transparent hover:border-gray-300">
                            Edit
                          </button>
                          <button onClick={() => deleteRevision(note.id)}
                            className="text-xs px-2 py-1 text-red-400 hover:text-red-600 border border-transparent hover:border-red-200">
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* Note body */}
                      <div className="p-4 flex gap-4">
                        {/* Screenshot thumbnail */}
                        {shotSrc && (
                          <div className="flex-shrink-0">
                            <button
                              onClick={() => {
                                setLightboxImage(shotSrc)
                                setLightboxLabel(shot?.timestamp_label || note.timestamp_label)
                              }}
                              className="block w-32 h-[72px] overflow-hidden border border-gray-200 hover:border-amber-400 transition-colors"
                            >
                              <img
                                src={shotSrc}
                                alt={`Screenshot at ${note.timestamp_label}`}
                                className="w-full h-full object-cover"
                              />
                            </button>
                            {note.screenshots && note.screenshots.length > 1 && (
                              <p className="text-xs text-gray-400 text-center mt-0.5">
                                +{note.screenshots.length - 1} more
                              </p>
                            )}
                          </div>
                        )}

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          {editingId === note.id ? (
                            <div className="flex gap-2">
                              <textarea
                                value={editText}
                                onChange={e => setEditText(e.target.value)}
                                rows={3}
                                className="flex-1 text-sm border-2 border-amber-300 px-2 py-1 focus:outline-none focus:border-amber-500"
                              />
                              <div className="flex flex-col gap-1">
                                <button onClick={() => saveEdit(note.id)}
                                  className="text-xs px-2 py-1 bg-amber-500 text-white hover:bg-amber-600">Save</button>
                                <button onClick={() => setEditingId(null)}
                                  className="text-xs px-2 py-1 border border-gray-300 text-gray-600 hover:bg-gray-50">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className={`text-sm leading-relaxed ${note.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                {note.note}
                              </p>
                              {note.raw_speech && note.raw_speech !== note.note && (
                                <p className="mt-1.5 text-xs text-gray-400 italic">
                                  Original: &ldquo;{note.raw_speech}&rdquo;
                                </p>
                              )}
                            </>
                          )}

                          {/* Extra screenshots */}
                          {note.screenshots && note.screenshots.length > 1 && (
                            <div className="mt-3 flex gap-2">
                              {note.screenshots.slice(1).map((s, si) => {
                                const src = s.image_base64 || s.image_url
                                return src ? (
                                  <button
                                    key={si}
                                    onClick={() => {
                                      setLightboxImage(src)
                                      setLightboxLabel(s.timestamp_label)
                                    }}
                                    className="w-20 h-[45px] overflow-hidden border border-gray-200 hover:border-amber-400 transition-colors"
                                  >
                                    <img src={src} alt={`Frame at ${s.timestamp_label}`} className="w-full h-full object-cover" />
                                  </button>
                                ) : null
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Transcript toggle */}
        {transcript.length > 0 && (
          <div className="mt-10">
            <button
              onClick={() => setShowTranscript(v => !v)}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              <span className={`transition-transform ${showTranscript ? 'rotate-90' : ''}`}>▶</span>
              {showTranscript ? 'Hide' : 'Show'} Full Transcript ({transcript.length} lines)
            </button>
            {showTranscript && (
              <div className="mt-4 bg-white border border-gray-200 divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                {transcript.map((line, i) => (
                  <div key={i} className="flex gap-4 px-4 py-2 hover:bg-gray-50">
                    <span className="text-xs font-mono font-semibold text-indigo-500 mt-0.5 flex-shrink-0 w-12">{line.t}</span>
                    <span className="text-sm text-gray-700 leading-relaxed">{line.s}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-mono text-gray-300">{lightboxLabel}</span>
              <button onClick={() => setLightboxImage(null)} className="text-white text-2xl leading-none">✕</button>
            </div>
            <img src={lightboxImage} alt="Screenshot" className="w-full max-h-[80vh] object-contain" />
          </div>
        </div>
      )}
    </div>
  )
}
