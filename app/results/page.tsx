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
  priority?: number
  complexity?: string
  project?: string
  client?: string
  area?: string
  assignee?: string
  task_type?: string
}

interface TranscriptLine {
  t: string  // timestamp label
  s: string  // spoken text
}

export default function Results() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [videoId, setVideoId] = useState('')
  const [summary, setSummary] = useState('')
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
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

  // Per-task completion (persisted to DB2 via Save & Share)
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set())

  // Save & Share
  const [savingSession, setSavingSession] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

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

      let sessionTranscript: TranscriptLine[] = []
      try {
        const raw = sessionStorage.getItem('loomResults')
        if (raw) {
          const data = JSON.parse(raw)
          if (data.tasks?.length > 0) {
            loadedTasks = data.tasks
            loadedVideoId = data.videoId || ''
            loadedSummary = data.summary || ''
            if (data.transcript?.length) sessionTranscript = data.transcript
          }
        }
      } catch {}

      // Always try IndexedDB — prefer it for images and as transcript fallback
      let idbTranscript: TranscriptLine[] = []
      if (loadedTasks.length === 0 || !loadedTasks[0]?.screenshots?.[0]?.image_base64) {
        try {
          const idb = await getProcessingResults()
          if (idb?.tasks?.length > 0) {
            loadedTasks = idb.tasks
            loadedVideoId = idb.videoId || ''
            loadedSummary = (idb as any).summary || ''
          }
          if ((idb as any)?.transcript?.length) idbTranscript = (idb as any).transcript
        } catch {}
      } else {
        // Tasks came from sessionStorage — still check IDB for transcript
        try {
          const idb = await getProcessingResults()
          if ((idb as any)?.transcript?.length) idbTranscript = (idb as any).transcript
        } catch {}
      }

      // Use IDB transcript first, fall back to sessionStorage transcript
      const resolvedTranscript = idbTranscript.length > 0 ? idbTranscript : sessionTranscript
      if (resolvedTranscript.length > 0) setTranscript(resolvedTranscript)

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

  const toggleTaskComplete = (id: string) => {
    setCompletedTaskIds(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const handleSaveAndShare = async () => {
    setSavingSession(true)
    try {
      const tasksWithCompletion = tasks.map(t => ({ ...t, completed: completedTaskIds.has(t._id) }))
      const titleGuess = tasks.length > 0 ? tasks[0].task_name : 'Extracted Tasks'
      const loomUrlGuess = tasks.length > 0 ? tasks[0].loom_url : ''

      const res = await fetch('/api/task-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleGuess,
          summary,
          loom_url: loomUrlGuess,
          video_id: videoId,
          tasks: tasksWithCompletion,
          transcript,
        }),
      })
      if (!res.ok) throw new Error('Failed to save session')
      const { id } = await res.json()
      const url = `${window.location.origin}/tasks/${id}`
      setShareUrl(url)
      setShowShareModal(true)
    } catch (err: any) {
      alert(`Failed to save task session: ${err.message}`)
    } finally {
      setSavingSession(false)
    }
  }

  const handleCopyShareUrl = () => {
    if (!shareUrl) return
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    }).catch(() => {})
  }

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

  const updateTaskUrgency = (id: string, value: string) => {
    setTasks(prev => prev.map(t => t._id === id ? { ...t, task_type: value } : t))
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
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210
    const pageH = 297
    const mL = 15
    const mR = 15
    const cW = pageW - mL - mR

    // ── helpers ──────────────────────────────────────────────────────
    const hr = (yPos: number) => {
      doc.setDrawColor(200, 200, 210)
      doc.setLineWidth(0.2)
      doc.line(mL, yPos, pageW - mR, yPos)
    }

    const sectionHeader = (title: string, yPos: number) => {
      doc.setFontSize(15)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 30, 100)
      doc.text(title, mL, yPos)
      yPos += 4
      doc.setDrawColor(60, 90, 220)
      doc.setLineWidth(0.6)
      doc.line(mL, yPos, pageW - mR, yPos)
      doc.setLineWidth(0.2)
      return yPos + 8
    }

    const drawFooter = (label: string, url: string) => {
      doc.setDrawColor(130, 130, 140)
      doc.setLineWidth(0.3)
      doc.line(mL, pageH - 13, pageW - mR, pageH - 13)
      doc.setLineWidth(0.2)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(110, 110, 120)
      doc.text(label, mL, pageH - 8)
      doc.setTextColor(40, 80, 180)
      doc.textWithLink(url, pageW - mR, pageH - 8, { url, align: 'right' })
    }

    // Fallback: read transcript directly from sessionStorage if state is empty
    let transcriptData = transcript
    if (transcriptData.length === 0) {
      try {
        const raw = sessionStorage.getItem('loomResults')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed.transcript?.length) transcriptData = parsed.transcript
        }
      } catch {}
    }

    // Page-number tracking (filled during generation, used for TOC)
    const taskPageNums: number[] = []
    let transcriptStartPage = 0
    let summaryStartPage = 0
    let tableStartPage = 0

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PAGE 1 — COVER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let y = 35
    doc.setFontSize(24)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 30, 100)
    doc.text('Loom Video', mL, y)
    y += 9
    doc.setFontSize(18)
    doc.setTextColor(60, 75, 160)
    doc.text('Extracted Tasks', mL, y)
    y += 5
    doc.setDrawColor(60, 90, 220)
    doc.setLineWidth(0.8)
    doc.line(mL, y, pageW - mR, y)
    doc.setLineWidth(0.2)
    y += 12

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 80)
    doc.text(`${tasks.length} tasks  •  see page 2 for Table of Contents`, mL, y)
    y += 10

    for (let i = 0; i < tasks.length; i++) {
      if (y > pageH - 25) break
      const t = tasks[i]
      const url = generateLoomUrlWithTimestamp(videoId, t.timestamp_seconds)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 20, 60)
      doc.text(`${i + 1}.`, mL + 2, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(20, 20, 20)
      const nameLabel = doc.splitTextToSize(t.task_name, cW - 42)
      doc.text(nameLabel[0], mL + 10, y)
      doc.setTextColor(40, 80, 180)
      doc.textWithLink(t.timestamp_label, pageW - mR - doc.getTextWidth(t.timestamp_label), y, { url })
      y += 6
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PAGE 2 — TABLE OF CONTENTS (blank — we come back to fill it)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    doc.addPage()
    const tocPageNum = doc.getNumberOfPages()  // always 2

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PAGES 3+ — ONE PAGE PER TASK
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      doc.addPage()
      taskPageNums[i] = doc.getNumberOfPages()
      y = 12

      const taskUrl = generateLoomUrlWithTimestamp(videoId, task.timestamp_seconds)

      // Header band
      doc.setFillColor(235, 238, 255)
      doc.rect(mL, y, cW, 22, 'F')
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(90, 100, 170)
      doc.text(`TASK ${i + 1} OF ${tasks.length}`, mL + 3, y + 5)
      doc.setFontSize(13)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(10, 15, 70)
      const titleLines = doc.splitTextToSize(task.task_name, cW - 8)
      doc.text(titleLines[0], mL + 3, y + 13)
      if (titleLines[1]) doc.text(titleLines[1], mL + 3, y + 19)
      y += 26

      // Timestamp + Loom link
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(60, 60, 80)
      doc.text('Timestamp:', mL, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(20, 20, 20)
      doc.text(task.timestamp_label, mL + 26, y)
      y += 6

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(60, 60, 80)
      doc.text('Loom Link:', mL, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(30, 70, 200)
      doc.textWithLink(taskUrl, mL + 26, y, { url: taskUrl })
      y += 8
      hr(y); y += 6

      // Description
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(60, 60, 80)
      doc.text('Description:', mL, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(25, 25, 25)
      const descLines = doc.splitTextToSize(task.task_description, cW)
      doc.text(descLines, mL, y)
      y += descLines.length * 5 + 8
      hr(y); y += 6

      // Screenshots
      const shots = task.screenshots?.length
        ? task.screenshots
        : (task.image_base64 || task.image_url)
          ? [{ image_url: task.image_url || '', image_base64: task.image_base64, timestamp_label: task.timestamp_label, timestamp_seconds: task.timestamp_seconds }]
          : []

      if (shots.length > 0) {
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(60, 60, 80)
        doc.text(`Screenshots (${shots.length})`, mL, y)
        y += 6

        const imgW = cW
        const imgH = Math.round(imgW * 9 / 16)

        for (let s = 0; s < shots.length; s++) {
          const shot = shots[s]
          const imgSrc = shot.image_base64 || shot.image_url
          const shotUrl = shot.timestamp_seconds
            ? generateLoomUrlWithTimestamp(videoId, shot.timestamp_seconds)
            : taskUrl

          if (y + imgH + 20 > pageH - 20) {
            doc.addPage()
            y = 12
            doc.setFontSize(8)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(110, 110, 160)
            doc.text(`Task ${i + 1} continued — ${task.task_name}`, mL, y)
            y += 8
          }

          doc.setFontSize(8)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(90, 90, 110)
          const shotLabel = shots.length > 1
            ? `Screenshot ${s + 1} / ${shots.length}  —  ${shot.timestamp_label}`
            : `Screenshot  —  ${shot.timestamp_label}`
          doc.text(shotLabel, mL, y)
          y += 4

          if (!imgSrc) {
            doc.setFontSize(9)
            doc.setTextColor(30, 70, 200)
            doc.textWithLink(`▶ ${shotUrl}`, mL, y, { url: shotUrl })
            y += 8
            continue
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
              } catch { base64Data = null }
            }
            if (!base64Data) throw new Error('no data')

            const pdfImg: string = await new Promise((resolve, reject) => {
              const img = new window.Image()
              img.onload = () => {
                const canvas = document.createElement('canvas')
                const scale = 2
                canvas.width = Math.round(imgW * scale * 3.7795)
                canvas.height = Math.round(imgH * scale * 3.7795)
                const ctx = canvas.getContext('2d')
                if (!ctx) { reject(new Error('no ctx')); return }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                resolve(canvas.toDataURL('image/jpeg', 0.88))
              }
              img.onerror = () => reject(new Error('load failed'))
              img.src = base64Data!
            })

            doc.addImage(pdfImg, 'JPEG', mL, y, imgW, imgH)
            doc.link(mL, y, imgW, imgH, { url: shotUrl })
            y += imgH + 3
            doc.setFontSize(8)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(30, 70, 200)
            doc.textWithLink(`▶ ${shotUrl}`, mL, y, { url: shotUrl })
            y += 8
          } catch {
            doc.setFontSize(9)
            doc.setTextColor(30, 70, 200)
            doc.textWithLink(`▶ ${shotUrl}`, mL, y, { url: shotUrl })
            y += 8
          }
        }
      } else {
        doc.setFontSize(9)
        doc.setTextColor(30, 70, 200)
        doc.textWithLink(`▶ ${taskUrl}`, mL, y, { url: taskUrl })
        y += 8
      }

      drawFooter(`Task ${i + 1} of ${tasks.length}  •  ${task.timestamp_label}`, taskUrl)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TRANSCRIPT SECTION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (transcriptData.length > 0) {
      doc.addPage()
      transcriptStartPage = doc.getNumberOfPages()
      y = sectionHeader('Full Transcript', 20)

      for (const line of transcriptData) {
        if (y > pageH - 20) {
          doc.addPage()
          y = 20
          doc.setFontSize(8)
          doc.setFont('helvetica', 'italic')
          doc.setTextColor(130, 130, 150)
          doc.text('Transcript (continued)', mL, y)
          y += 7
        }

        doc.setFontSize(8)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(50, 70, 160)
        doc.text(`[${line.t}]`, mL, y)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(20, 20, 20)
        const lineText = doc.splitTextToSize(line.s, cW - 22)
        doc.text(lineText, mL + 20, y)
        y += lineText.length * 4.5 + 1.5
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // SUMMARY PAGE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (summary) {
      doc.addPage()
      summaryStartPage = doc.getNumberOfPages()
      y = sectionHeader('Video Summary', 20)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(25, 25, 25)
      const summaryLines = doc.splitTextToSize(summary, cW)
      doc.text(summaryLines, mL, y)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TASK SUMMARY TABLE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    doc.addPage()
    tableStartPage = doc.getNumberOfPages()
    y = sectionHeader('Task Summary Table', 20)

    const priorityLabel = (p: number | undefined) => {
      if (p === undefined || p === null) return '3.0'
      const n = Number(p)
      if (isNaN(n)) return '3.0'
      return n.toFixed(1)
    }

    const nm = 'Not mentioned'
    const tableRows = tasks.map((t, i) => [
      t.task_name,
      t.task_description || nm,
      t.project || nm,
      t.client || nm,
      t.area || nm,
      t.assignee || nm,
      priorityLabel(t.priority),
      t.complexity || nm,
      t.task_type || 'Nice-to-have',
      generateLoomUrlWithTimestamp(videoId, t.timestamp_seconds),
    ])

    autoTable(doc, {
      startY: y,
      head: [['Title', 'DESC.', 'Project', 'Client', 'Area', 'Assignee', 'Priority', 'Complexity', 'Type', 'Explanation URL']],
      body: tableRows,
      theme: 'grid',
      rowPageBreak: 'avoid',
      styles: {
        fontSize: 7,
        cellPadding: 2,
        textColor: [20, 20, 20] as [number, number, number],
        lineColor: [180, 180, 190] as [number, number, number],
        lineWidth: 0.2,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [230, 232, 240] as [number, number, number],
        textColor: [20, 20, 60] as [number, number, number],
        fontStyle: 'bold',
        fontSize: 7,
      },
      alternateRowStyles: {
        fillColor: [248, 249, 252] as [number, number, number],
      },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 36 },
        2: { cellWidth: 16 },
        3: { cellWidth: 16 },
        4: { cellWidth: 16 },
        5: { cellWidth: 16 },
        6: { cellWidth: 12 },
        7: { cellWidth: 12 },
        8: { cellWidth: 18 },
        9: { cellWidth: 'auto' as any, textColor: [30, 70, 200] as [number, number, number] },
      },
      margin: { left: mL, right: mR },
      didDrawCell: (data: any) => {
        // Add a clickable link over every URL cell (column 9, skip header row)
        if (data.column.index === 9 && data.row.index >= 0 && data.row.section === 'body') {
          const url = String(data.cell.raw || '')
          if (url.startsWith('http')) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url })
          }
        }
      },
    })

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // GO BACK TO PAGE 2 — FILL TABLE OF CONTENTS WITH PAGE LINKS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    doc.setPage(tocPageNum)
    y = 20
    doc.setFontSize(15)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 30, 100)
    doc.text('Table of Contents', mL, y)
    y += 4
    doc.setDrawColor(60, 90, 220)
    doc.setLineWidth(0.6)
    doc.line(mL, y, pageW - mR, y)
    doc.setLineWidth(0.2)
    y += 10

    // Helper: draw one TOC row with a dotted leader and page link
    const tocRow = (label: string, pageNum: number, indent = 0, bold = false) => {
      const labelX = mL + indent
      const pageStr = `${pageNum}`
      const pageX = pageW - mR - doc.getTextWidth(pageStr) - 1

      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(bold ? 10 : 9)
      doc.setTextColor(20, 20, 20)

      // Clip label so it doesn't overlap dots
      const labelLines = doc.splitTextToSize(label, pageX - labelX - 6)
      doc.text(labelLines[0], labelX, y)

      // Dotted leader
      const labelEnd = labelX + doc.getTextWidth(labelLines[0])
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(160, 160, 170)
      let dotX = labelEnd + 2
      while (dotX < pageX - 4) { doc.text('.', dotX, y); dotX += 2.5 }

      // Page number
      doc.setTextColor(20, 20, 20)
      doc.setFontSize(9)
      doc.text(pageStr, pageX, y)

      // Invisible link over the whole row
      doc.link(mL, y - 5, cW, 7, { pageNumber: pageNum })

      y += bold ? 8 : 6
    }

    // Section: Tasks
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(50, 70, 160)
    doc.text('TASKS', mL, y)
    y += 5

    for (let i = 0; i < tasks.length; i++) {
      tocRow(`${i + 1}.  ${tasks[i].task_name}`, taskPageNums[i], 2)
    }
    y += 4

    // Section: Transcript
    if (transcriptStartPage > 0) {
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(50, 70, 160)
      doc.text('APPENDIX', mL, y)
      y += 5
      tocRow('Full Transcript', transcriptStartPage, 2, true)
    }

    // Section: Summary
    if (summaryStartPage > 0) {
      tocRow('Video Summary', summaryStartPage, 2, true)
    }

    // Section: Table
    tocRow('Task Summary Table', tableStartPage, 2, true)

    // Build a meaningful filename from the first task name
    const toSlug = (text: string, maxWords = 4) => {
      const stopWords = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','be','has','have','do','did','not','as','it','this','that','we','they','you','can','will','need'])
      return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
        .slice(0, maxWords)
        .join('-') || 'tasks'
    }
    const titleSlug = tasks.length > 0 ? toSlug(tasks[0].task_name) : 'tasks'
    const dateSlug = new Date().toISOString().slice(0, 10)
    doc.save(`loom-tasks-${titleSlug}-${dateSlug}.pdf`)
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
              onClick={handleSaveAndShare}
              disabled={savingSession}
              className="bg-blue-600 text-white px-5 py-2 font-semibold hover:bg-blue-700 transition-colors border-2 border-blue-700 disabled:opacity-60 disabled:cursor-wait"
            >
              {savingSession ? '⏳ Saving…' : '🔗 Save & Share'}
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
                          {/* Urgency dropdown */}
                          <select
                            value={task.task_type || 'Nice-to-have'}
                            onChange={e => updateTaskUrgency(task._id, e.target.value)}
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
                        <p className="text-gray-700 leading-relaxed">{task.task_description}</p>
                      </>
                    )}
                  </div>

                  {editingTaskId !== task._id && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => toggleTaskComplete(task._id)}
                        title={completedTaskIds.has(task._id) ? 'Mark pending' : 'Mark complete'}
                        className={`w-8 h-8 flex items-center justify-center border transition-colors ${
                          completedTaskIds.has(task._id)
                            ? 'bg-green-500 border-green-500 text-white hover:bg-green-600'
                            : 'border-gray-200 text-gray-400 hover:text-green-600 hover:bg-green-50 hover:border-green-400'
                        }`}
                      >
                        <span className="text-xs font-bold">✓</span>
                      </button>
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

      </div>{/* max-w-5xl */}

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

      {/* ── Share Modal ── */}
      {showShareModal && shareUrl && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4"
          onClick={() => setShowShareModal(false)}
        >
          <div
            className="bg-white max-w-lg w-full p-8 shadow-2xl border-2 border-blue-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">🔗 Session Saved!</h2>
                <p className="text-gray-600 mt-1 text-sm">Anyone with this link can view tasks and mark them complete.</p>
              </div>
              <button onClick={() => setShowShareModal(false)}
                className="text-gray-400 hover:text-gray-700 text-2xl font-bold w-8 h-8 flex items-center justify-center">
                ×
              </button>
            </div>

            <div className="bg-gray-50 border-2 border-gray-200 p-3 mb-5 break-all text-sm text-gray-800 font-mono select-all">
              {shareUrl}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCopyShareUrl}
                className={`flex-1 py-2.5 font-semibold border-2 transition-colors ${
                  copySuccess
                    ? 'bg-green-100 border-green-400 text-green-700'
                    : 'bg-blue-600 border-blue-700 text-white hover:bg-blue-700'
                }`}
              >
                {copySuccess ? '✓ Copied!' : '📋 Copy Link'}
              </button>
              <a
                href={shareUrl as string}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2.5 font-semibold border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 transition-colors text-center"
              >
                ↗ Open Link
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
