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
  referenced_timestamp_seconds?: number | null
  referenced_timestamp_label?: string | null
  note: string
  raw_speech?: string
  completed: boolean
  loom_url?: string
  screenshots?: RevisionScreenshot[]
}

type FilterType = 'all' | 'pending' | 'completed' | 'global'

export default function RevisionPage() {
  const router = useRouter()
  const [loaded, setLoaded] = useState(false)
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
  const [lightboxScreenshots, setLightboxScreenshots] = useState<RevisionScreenshot[]>([])
  const [lightboxIndex, setLightboxIndex] = useState(0)

  // Keyboard nav for lightbox
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

  useEffect(() => {
    const loadData = async () => {
      const { getRevisionResults } = await import('@/lib/imageStorage')
      const data = await getRevisionResults()

      if (!data) {
        alert('No revision results found. Please process a video first.')
        router.push('/')
        return
      }

      setTitle(data.title || 'Revision Notes')
      setSummary(data.summary || '')
      setVideoId(data._originalVideoId || data.videoId || '')
      setLoomUrl(data.loomUrl || '')
      setGlobalNotes((data.global_notes || []).map((n: any, i: number) => ({ ...n, id: n.id ?? `g-${i}` })))
      setRevisionNotes((data.revision_notes || []).map((n: any, i: number) => ({ ...n, id: n.id ?? `r-${i}` })))
      setTranscript(data.transcript || [])
      setLoaded(true)
    }

    loadData().catch(() => router.push('/'))
  }, [router])

  // ── helpers ──────────────────────────────────────────────────────────────
  const toggleGlobal = (id: string) => setGlobalNotes(prev => prev.map(n => n.id === id ? { ...n, completed: !n.completed } : n))
  const deleteGlobal = (id: string) => setGlobalNotes(prev => prev.filter(n => n.id !== id))
  const toggleRevision = (id: string) => setRevisionNotes(prev => prev.map(n => n.id === id ? { ...n, completed: !n.completed } : n))
  const deleteRevision = (id: string) => setRevisionNotes(prev => prev.filter(n => n.id !== id))

  const startEdit = (id: string, text: string) => { setEditingId(id); setEditText(text) }
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

  const openLightbox = (screenshots: RevisionScreenshot[], index: number) => {
    const s = screenshots[index]
    setLightboxScreenshots(screenshots)
    setLightboxIndex(index)
    setLightboxImage(s.image_base64 || s.image_url)
    setLightboxLabel(s.timestamp_label)
  }

  const loomTimestampUrl = (ts: number) =>
    videoId ? `https://www.loom.com/share/${videoId}?t=${ts}` : (loomUrl || '')

  const pendingCount = revisionNotes.filter(n => !n.completed).length + globalNotes.filter(n => !n.completed).length
  const completedCount = revisionNotes.filter(n => n.completed).length + globalNotes.filter(n => n.completed).length
  const totalCount = globalNotes.length + revisionNotes.length
  // Tab counts — only revision notes (global has its own tab)
  const revisionPendingCount = revisionNotes.filter(n => !n.completed).length
  const revisionCompletedCount = revisionNotes.filter(n => n.completed).length

  const visibleRevisionNotes = revisionNotes.filter(n => {
    if (filter === 'pending') return !n.completed
    if (filter === 'completed') return n.completed
    if (filter === 'global') return false
    return true
  })
  const showGlobalSection = filter === 'all' || filter === 'global'

  // ── PDF export ────────────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210, pageH = 297, mL = 15, mR = 15, cW = pageW - mL - mR

    const hr = (yPos: number) => {
      doc.setDrawColor(200, 200, 210); doc.setLineWidth(0.2)
      doc.line(mL, yPos, pageW - mR, yPos)
    }
    const sectionHeader = (text: string, yPos: number) => {
      doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 30, 100)
      doc.text(text, mL, yPos); yPos += 4
      doc.setDrawColor(60, 90, 220); doc.setLineWidth(0.6)
      doc.line(mL, yPos, pageW - mR, yPos); doc.setLineWidth(0.2)
      return yPos + 8
    }
    const drawFooter = (label: string, url: string) => {
      doc.setDrawColor(130, 130, 140); doc.setLineWidth(0.3)
      doc.line(mL, pageH - 13, pageW - mR, pageH - 13); doc.setLineWidth(0.2)
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 110, 120)
      doc.text(label, mL, pageH - 8)
      if (url) { doc.setTextColor(40, 80, 180); doc.textWithLink(url, pageW - mR, pageH - 8, { url, align: 'right' }) }
    }

    const notePageNums: number[] = []
    let globalSectionPage = 0
    const dateStr = new Date().toLocaleDateString()

    // ── COVER ──────────────────────────────────────────────────────────────
    let y = 35
    doc.setFontSize(24); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 30, 100)
    doc.text('Loom Video', mL, y); y += 9
    doc.setFontSize(18); doc.setTextColor(180, 120, 20)
    doc.text('Revision Notes', mL, y); y += 5
    doc.setDrawColor(200, 140, 30); doc.setLineWidth(0.8)
    doc.line(mL, y, pageW - mR, y); doc.setLineWidth(0.2); y += 12

    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 80)
    doc.text(`Generated: ${dateStr}  •  ${globalNotes.length} global notes  •  ${revisionNotes.length} timestamped revisions`, mL, y); y += 8

    if (loomUrl) {
      doc.setFontSize(9); doc.setTextColor(30, 70, 200)
      doc.textWithLink(`Loom Source: ${loomUrl}`, mL, y, { url: loomUrl }); y += 7
    }
    if (title) {
      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
      const titleLines = doc.splitTextToSize(title, cW)
      doc.text(titleLines, mL, y); y += titleLines.length * 6 + 6
    }
    if (summary) {
      doc.setFontSize(10); doc.setFont('helvetica', 'italic'); doc.setTextColor(50, 50, 70)
      const sumLines = doc.splitTextToSize(summary, cW)
      doc.text(sumLines, mL, y); y += sumLines.length * 5 + 8
    }

    hr(y); y += 8
    for (let i = 0; i < Math.min(revisionNotes.length, 20); i++) {
      if (y > pageH - 25) break
      const n = revisionNotes[i]
      const url = n.loom_url || loomTimestampUrl(n.timestamp_seconds)
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 60)
      doc.text(`${i + 1}.`, mL + 2, y)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20)
      const label = doc.splitTextToSize(n.note, cW - 42)
      doc.text(label[0], mL + 10, y)
      doc.setTextColor(40, 80, 180)
      if (url) doc.textWithLink(n.timestamp_label, pageW - mR - doc.getTextWidth(n.timestamp_label), y, { url })
      else doc.text(n.timestamp_label, pageW - mR - doc.getTextWidth(n.timestamp_label), y)
      y += 6
    }

    // ── TOC (blank — fill later) ───────────────────────────────────────────
    doc.addPage()
    const tocPageNum = doc.getNumberOfPages()

    // ── GLOBAL NOTES ──────────────────────────────────────────────────────
    if (globalNotes.length > 0) {
      doc.addPage()
      globalSectionPage = doc.getNumberOfPages()
      y = sectionHeader('Global Notes', 20)
      globalNotes.forEach((note, i) => {
        if (y > pageH - 20) { doc.addPage(); y = 20 }
        const prefix = note.completed ? '☑' : '☐'
        doc.setFontSize(9); doc.setFont('helvetica', note.completed ? 'italic' : 'normal')
        doc.setTextColor(note.completed ? 130 : 20, note.completed ? 130 : 20, note.completed ? 130 : 20)
        const lines = doc.splitTextToSize(`${prefix}  ${i + 1}. ${note.note}`, cW - 4)
        doc.text(lines, mL + 2, y); y += lines.length * 5 + 3
      })
      drawFooter('Global Notes', loomUrl || '')
    }

    // ── TIMESTAMPED NOTES ─────────────────────────────────────────────────
    for (let i = 0; i < revisionNotes.length; i++) {
      const note = revisionNotes[i]
      doc.addPage()
      notePageNums[i] = doc.getNumberOfPages()
      y = 12

      const noteUrl = note.loom_url || loomTimestampUrl(note.timestamp_seconds)

      // Header band
      doc.setFillColor(note.completed ? 240 : 253, note.completed ? 248 : 237, note.completed ? 240 : 215)
      doc.rect(mL, y, cW, 22, 'F')
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120, 90, 20)
      doc.text(`REVISION ${i + 1} OF ${revisionNotes.length}${note.completed ? '  ✓ COMPLETED' : ''}`, mL + 3, y + 5)
      doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(10, 15, 70)
      const hLines = doc.splitTextToSize(note.note, cW - 8)
      doc.text(hLines[0], mL + 3, y + 13)
      if (hLines[1]) doc.text(hLines[1], mL + 3, y + 19)
      y += 26

      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 60, 80)
      doc.text('Timestamp:', mL, y)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20)
      doc.text(note.timestamp_label, mL + 26, y); y += 6

      if (noteUrl) {
        doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 60, 80)
        doc.text('Loom Link:', mL, y)
        doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 70, 200)
        doc.textWithLink(noteUrl, mL + 26, y, { url: noteUrl }); y += 8
      }
      hr(y); y += 6

      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 60, 80)
      doc.text('Revision Note:', mL, y); y += 5
      doc.setFont('helvetica', note.completed ? 'italic' : 'normal'); doc.setFontSize(10); doc.setTextColor(25, 25, 25)
      const noteLines = doc.splitTextToSize(note.note, cW)
      doc.text(noteLines, mL, y); y += noteLines.length * 5 + 5

      if (note.raw_speech && note.raw_speech !== note.note) {
        doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor(130, 130, 130)
        const rawLines = doc.splitTextToSize(`Original speech: "${note.raw_speech}"`, cW)
        doc.text(rawLines, mL, y); y += rawLines.length * 4.5 + 5
      }
      hr(y); y += 6

      // Screenshots with clickable links
      const shots = (note.screenshots || []).filter(s => s.image_base64 || s.image_url)
      if (shots.length > 0) {
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 60, 80)
        doc.text(`Screenshots (${shots.length})`, mL, y); y += 6
        const imgW = cW
        const imgH = Math.round(imgW * 9 / 16)

        for (let s = 0; s < shots.length; s++) {
          const shot = shots[s]
          const imgSrc = shot.image_base64 || shot.image_url
          // Always link to the note's transcript timestamp (when user mentioned the revision)
          const shotUrl = noteUrl

          if (y + imgH + 20 > pageH - 20) {
            doc.addPage(); y = 12
            doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 110, 160)
            doc.text(`Revision ${i + 1} continued — ${note.timestamp_label}`, mL, y); y += 8
          }

          doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 110)
          doc.text(
            shots.length > 1 ? `Screenshot ${s + 1}/${shots.length}  —  ${note.timestamp_label}` : `Screenshot  —  ${note.timestamp_label}`,
            mL, y
          ); y += 4

          if (!imgSrc) {
            if (shotUrl) { doc.setFontSize(9); doc.setTextColor(30, 70, 200); doc.textWithLink(`▶ ${shotUrl}`, mL, y, { url: shotUrl }) }
            y += 8; continue
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
            if (shotUrl) doc.link(mL, y, imgW, imgH, { url: shotUrl }) // ← clickable image
            y += imgH + 3
            if (shotUrl) {
              doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 70, 200)
              doc.textWithLink(`▶ ${shotUrl}`, mL, y, { url: shotUrl })
            }
            y += 8
          } catch {
            if (shotUrl) { doc.setFontSize(9); doc.setTextColor(30, 70, 200); doc.textWithLink(`▶ ${shotUrl}`, mL, y, { url: shotUrl }) }
            y += 8
          }
        }
      } else if (noteUrl) {
        doc.setFontSize(9); doc.setTextColor(30, 70, 200)
        doc.textWithLink(`▶ ${noteUrl}`, mL, y, { url: noteUrl }); y += 8
      }

      drawFooter(`Revision ${i + 1} of ${revisionNotes.length}  •  ${note.timestamp_label}`, noteUrl)
    }

    // ── FILL TOC ──────────────────────────────────────────────────────────
    doc.setPage(tocPageNum)
    y = 20
    doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 30, 100)
    doc.text('Table of Contents', mL, y); y += 4
    doc.setDrawColor(200, 140, 30); doc.setLineWidth(0.6)
    doc.line(mL, y, pageW - mR, y); doc.setLineWidth(0.2); y += 10

    const tocRow = (label: string, pageNum: number, indent = 0, bold = false) => {
      const labelX = mL + indent
      const pageStr = `${pageNum}`
      const pageX = pageW - mR - doc.getTextWidth(pageStr) - 1
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(bold ? 10 : 9); doc.setTextColor(20, 20, 20)
      const labelLines = doc.splitTextToSize(label, pageX - labelX - 6)
      doc.text(labelLines[0], labelX, y)
      const labelEnd = labelX + doc.getTextWidth(labelLines[0])
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 160, 170)
      let dotX = labelEnd + 2
      while (dotX < pageX - 4) { doc.text('.', dotX, y); dotX += 2.5 }
      doc.setTextColor(20, 20, 20); doc.setFontSize(9)
      doc.text(pageStr, pageX, y)
      doc.link(mL, y - 5, cW, 7, { pageNumber: pageNum })
      y += bold ? 8 : 6
    }

    if (globalSectionPage > 0) {
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(50, 70, 160)
      doc.text('GLOBAL', mL, y); y += 5
      tocRow('Global Notes', globalSectionPage, 2, true); y += 4
    }
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(50, 70, 160)
    doc.text('TIMESTAMPED REVISIONS', mL, y); y += 5
    for (let i = 0; i < revisionNotes.length; i++) {
      if (y > pageH - 15) break
      tocRow(`${i + 1}.  [${revisionNotes[i].timestamp_label}]  ${revisionNotes[i].note}`, notePageNums[i], 2)
    }

    // Build a meaningful filename from the AI-generated title
    const toSlug = (text: string, maxWords = 4) => {
      const stopWords = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','be','has','have','do','did','not','as','it','this','that','we','they','you','can','will','need'])
      return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
        .slice(0, maxWords)
        .join('-') || 'revision'
    }
    const titleSlug = title ? toSlug(title) : 'revision'
    const dateSlug = new Date().toISOString().slice(0, 10)
    doc.save(`revision-${titleSlug}-${dateSlug}.pdf`)
  }

  // ── DOCX export ───────────────────────────────────────────────────────────
  const handleExportDocx = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, ImageRun } = await import('docx') as any

    const dateStr = new Date().toLocaleDateString()
    const children: any[] = []

    children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 120 } }))

    const metaParts: any[] = [
      new TextRun({ text: `Generated: ${dateStr}`, color: '555555', size: 18 }),
      new TextRun({ text: `   |   ${globalNotes.length} global notes  ·  ${revisionNotes.length} timestamped revisions`, color: '555555', size: 18 }),
    ]
    if (loomUrl) {
      metaParts.push(
        new TextRun({ text: '   |   ', color: '555555', size: 18 }),
        new ExternalHyperlink({ link: loomUrl, children: [new TextRun({ text: 'Open source video', color: '1155CC', size: 18, underline: {} })] })
      )
    }
    children.push(new Paragraph({ children: metaParts, spacing: { after: 80 } }))

    if (summary) {
      children.push(new Paragraph({
        children: [new TextRun({ text: summary, italics: true, color: '444466', size: 20 })],
        spacing: { after: 200 },
      }))
    }

    if (globalNotes.length > 0) {
      children.push(new Paragraph({ text: 'Global Notes', heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } }))
      globalNotes.forEach((note, i) => {
        const check = note.completed ? '☑' : '☐'
        children.push(new Paragraph({
          children: [new TextRun({ text: `${check}  ${i + 1}.  ${note.note}`, size: 20, strike: note.completed, color: note.completed ? '888888' : '111111' })],
          spacing: { before: 60, after: 60 },
          indent: { left: 360 },
        }))
      })
    }

    if (revisionNotes.length > 0) {
      children.push(new Paragraph({ text: 'Timestamped Revision Notes', heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } }))
      for (const note of revisionNotes) {
        const tsChildren: any[] = [
          new TextRun({ text: `[${note.timestamp_label}]  `, bold: true, color: note.completed ? '888888' : '2244AA', size: 20 }),
        ]
        if (note.loom_url) {
          tsChildren.push(new ExternalHyperlink({
            link: note.loom_url,
            children: [new TextRun({ text: '↗ Jump to video', color: '1155CC', size: 18, underline: {} })],
          }))
        }
        children.push(new Paragraph({ children: tsChildren, spacing: { before: 200, after: 60 } }))
        // Unicode checkbox
        children.push(new Paragraph({
          children: [new TextRun({ text: `${note.completed ? '☑' : '☐'}  ${note.note}`, size: 20, strike: note.completed, color: note.completed ? '888888' : '111111' })],
          spacing: { before: 20, after: 60 },
          indent: { left: 360 },
        }))
        if (note.raw_speech && note.raw_speech !== note.note) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `Original: "${note.raw_speech}"`, italics: true, color: '999999', size: 18 })],
            indent: { left: 360 },
            spacing: { before: 20, after: 120 },
          }))
        }
        // Screenshots
        const shots = (note.screenshots || []).filter((s: any) => s.image_base64 || s.image_url)
        if (shots.length > 0) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `Screenshots (${shots.length}):`, bold: true, size: 18, color: '555555' })],
            spacing: { before: 80, after: 40 },
            indent: { left: 360 },
          }))
          for (const shot of shots) {
            try {
              const src: string = shot.image_base64 || shot.image_url || ''
              let base64: string | null = null
              if (src.startsWith('data:')) {
                base64 = src.split(',')[1] || null
              } else if (src.startsWith('http')) {
                try {
                  const resp = await fetch(src)
                  const buf = await resp.arrayBuffer()
                  base64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
                } catch { base64 = null }
              }
              if (base64) {
                children.push(new Paragraph({
                  children: [
                    new ImageRun({
                      data: base64,
                      transformation: { width: 400, height: 225 },
                      type: 'jpg',
                    }),
                  ],
                  spacing: { before: 40, after: 20 },
                  indent: { left: 360 },
                }))
                const shotUrl = shot.timestamp_seconds
                  ? loomTimestampUrl(shot.timestamp_seconds)
                  : (note.loom_url || loomTimestampUrl(note.timestamp_seconds))
                const capChildren: any[] = [
                  new TextRun({ text: `⏱ ${shot.timestamp_label}`, size: 16, color: '444466', bold: true }),
                ]
                if (shotUrl) {
                  capChildren.push(
                    new TextRun({ text: '   ' }),
                    new ExternalHyperlink({ link: shotUrl, children: [new TextRun({ text: '↗ Open in Loom', color: '1155CC', size: 16, underline: {} })] })
                  )
                }
                children.push(new Paragraph({ children: capChildren, spacing: { before: 0, after: 80 }, indent: { left: 360 } }))
              }
            } catch { /* skip failed image */ }
          }
        }
      }
    }

    const doc = new Document({ title, description: summary, sections: [{ children }] })
    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `revision-notes-${new Date().toISOString().slice(0, 10)}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">Loading revision notes...</p>
        </div>
      </div>
    )
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">

        {/* ── Header — same layout as task list ── */}
        <div className="flex flex-wrap justify-between items-start gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 border border-amber-200">
                ✏️ REVISION NOTES
              </span>
            </div>
            <h1 className="text-4xl font-bold text-gray-900">{title}</h1>
            <p className="text-gray-500 mt-1">
              {globalNotes.length} global note{globalNotes.length !== 1 ? 's' : ''} · {revisionNotes.length} timestamped revision{revisionNotes.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleExportPDF}
              className="bg-green-600 text-white px-5 py-2 font-semibold hover:bg-green-700 transition-colors border-2 border-green-700"
            >
              📄 Export PDF
            </button>
            <button
              onClick={handleExportDocx}
              className="bg-amber-500 text-black px-5 py-2 font-semibold hover:bg-amber-600 transition-colors border-2 border-amber-600"
            >
              📝 Export .docx
            </button>
            <button
              onClick={() => router.push('/')}
              className="bg-gray-200 text-gray-700 px-5 py-2 font-semibold hover:bg-gray-300 transition-colors border-2 border-gray-300"
            >
              ← New Video
            </button>
          </div>
        </div>

        {/* ── Progress card ── */}
        <div className="bg-amber-50 border-2 border-amber-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-amber-800">📋 Progress</h2>
            <div className="text-right">
              <span className="text-3xl font-bold text-amber-600">{completedCount}</span>
              <span className="text-gray-400 text-xl">/{totalCount}</span>
              <div className="text-xs text-gray-500 mt-0.5">completed</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm mb-3">
            <span className="text-gray-600"><span className="font-semibold text-indigo-700">{globalNotes.length}</span> global</span>
            <span className="text-gray-600"><span className="font-semibold text-amber-700">{revisionNotes.length}</span> timestamped</span>
            <span className="text-gray-600"><span className="font-semibold text-green-700">{completedCount}</span> done</span>
            <span className="text-gray-600"><span className="font-semibold text-red-600">{pendingCount}</span> pending</span>
            {loomUrl && (
              <a href={loomUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs text-indigo-600 hover:underline font-medium">
                ↗ Open source video
              </a>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={markAllComplete}
              className="px-4 py-1.5 text-sm font-semibold border-2 border-green-400 text-black bg-white hover:bg-green-50 transition-colors">
              ✓ Mark all complete
            </button>
            <button onClick={markAllPending}
              className="px-4 py-1.5 text-sm font-semibold border-2 border-gray-300 text-black bg-white hover:bg-gray-50 transition-colors">
              ↺ Reset all
            </button>
          </div>
        </div>

        {/* ── Summary ── */}
        {summary && (
          <div className="bg-indigo-50 border-2 border-indigo-200 p-5 mb-6">
            <h2 className="text-lg font-bold text-indigo-800">📋 Video Summary</h2>
            <p className="text-gray-700 leading-relaxed mt-2">{summary}</p>
          </div>
        )}

        {/* ── Filter tabs ── */}
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
               f === 'pending' ? `Timestamps Notes (${revisionPendingCount})` :
               f === 'completed' ? `Completed (${revisionCompletedCount})` :
               `Global Notes (${globalNotes.length})`}
            </button>
          ))}
        </div>

        {/* ── Global Notes ── */}
        {showGlobalSection && globalNotes.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">🌐 Global Notes</h2>
            <div className="space-y-3">
              {globalNotes.map(note => (
                <div
                  key={note.id}
                  className={`bg-white shadow-md overflow-hidden transition-shadow border-2 ${
                    note.completed ? 'border-green-300 opacity-80' : 'border-gray-200 hover:shadow-lg'
                  }`}
                >
                  <div className="p-5">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => toggleGlobal(note.id)}
                        className={`mt-0.5 w-5 h-5 flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                          note.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-indigo-500'
                        }`}
                      >
                        {note.completed && <span className="text-xs">✓</span>}
                      </button>
                      <div className="flex-1 min-w-0">
                        {editingId === note.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editText}
                              onChange={e => setEditText(e.target.value)}
                              rows={2}
                              className="w-full border-2 border-indigo-300 px-3 py-2 text-gray-800 text-sm resize-none focus:outline-none focus:border-indigo-500"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <button onClick={() => saveEdit(note.id)}
                                className="px-4 py-1.5 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
                              <button onClick={() => setEditingId(null)}
                                className="px-4 py-1.5 text-sm font-semibold border border-gray-300 text-black bg-white hover:bg-gray-50">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <p className={`text-base leading-relaxed ${note.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                            {note.note}
                          </p>
                        )}
                      </div>
                      {editingId !== note.id && (
                        <div className="flex gap-2 flex-shrink-0">
                          <button onClick={() => startEdit(note.id, note.note)} title="Edit"
                            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 border border-gray-200 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button onClick={() => deleteGlobal(note.id)} title="Delete"
                            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 border border-gray-200 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
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

        {/* ── Timestamped Revision Notes ── */}
        {filter !== 'global' && (
        <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              ⏱ Timestamped Revision Notes
              {visibleRevisionNotes.length !== revisionNotes.length && (
                <span className="text-sm font-normal text-gray-500 ml-2">
                  — showing {visibleRevisionNotes.length} of {revisionNotes.length}
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
                            onClick={() => toggleRevision(note.id)}
                            className={`mt-1 w-5 h-5 flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                              note.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-amber-500'
                            }`}
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
                              <div className="space-y-3">
                                <textarea
                                  value={editText}
                                  onChange={e => setEditText(e.target.value)}
                                  rows={3}
                                  className="w-full border-2 border-amber-300 px-3 py-2 text-gray-800 resize-none focus:outline-none focus:border-amber-500"
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <button onClick={() => saveEdit(note.id)}
                                    className="px-4 py-1.5 text-sm font-semibold bg-amber-500 text-black hover:bg-amber-600">Save</button>
                                  <button onClick={() => setEditingId(null)}
                                    className="px-4 py-1.5 text-sm font-semibold border border-gray-300 text-black bg-white hover:bg-gray-50">Cancel</button>
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
                            <div className="flex gap-2 flex-shrink-0">
                              <button onClick={() => startEdit(note.id, note.note)} title="Edit"
                                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-amber-600 hover:bg-amber-50 border border-gray-200 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                              <button onClick={() => deleteRevision(note.id)} title="Delete"
                                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 border border-gray-200 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Screenshots grid — same style as task list */}
                        {shots.length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                              Screenshots ({shots.length})
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                              {shots.map((shot, si) => {
                                const src = shot.image_base64 || shot.image_url
                                // Each badge is unique to this frame — same as tasks mode
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

        {/* ── Transcript ── */}
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

      {/* ── Lightbox — same style as task list ── */}
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
    </div>
  )
}
