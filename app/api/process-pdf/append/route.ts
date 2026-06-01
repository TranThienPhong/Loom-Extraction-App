import { NextRequest, NextResponse } from 'next/server'
import { parsePdfToBlocks, PdfBlock } from '@/lib/pdfParser'
import { analyzePdfBlocksWithAI, generatePdfSummary, PdfBlockForAI } from '@/lib/aiProviders'
import { getDBContext, formatDBContextForPrompt } from '@/lib/dbContext'
import { getExtractionResult, updateExtractionResult } from '@/lib/resultsDb'
import { withExistingTasksContext } from '@/lib/appendContext'

export const maxDuration = 300 // 5 minutes — PDF parsing + AI is fast vs. video

/**
 * Append another PDF to an existing PDF-source task session. Mirrors
 * /api/process-loom/append but for the PDF flow: parse the new PDF, analyze
 * ONLY its blocks (with the session's existing tasks as anti-dup context), tag
 * the new tasks/blocks with a part index, merge into the saved payload, and
 * regenerate the combined summary so the document stays one unified knowledge
 * base. Existing tasks and their screenshots are left untouched.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const id = formData.get('id')
    const file = formData.get('file')

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'extraction id is required' }, { status: 400 })
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing PDF file (field name: "file")' }, { status: 400 })
    }
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Uploaded file must be a PDF' }, { status: 400 })
    }

    // Load the existing extraction we're appending to.
    const existing = await getExtractionResult(id)
    if (!existing) {
      return NextResponse.json({ error: `Extraction ${id} not found` }, { status: 404 })
    }
    if (existing.mode !== 'task') {
      return NextResponse.json({ error: 'Append is only supported for task-mode extractions' }, { status: 400 })
    }
    if (existing.source !== 'pdf') {
      return NextResponse.json(
        { error: 'This session was created from a Loom video — add another Loom video instead of a PDF.' },
        { status: 400 },
      )
    }

    const existingPayload = existing.payload || {}
    const existingTasks: any[] = Array.isArray(existingPayload.tasks) ? existingPayload.tasks : []
    const existingTranscript: Array<{ t: string; s: string; v?: number }> =
      Array.isArray(existingPayload.transcript) ? existingPayload.transcript : []
    const existingFileNames: string[] = Array.isArray(existingPayload.pdfFileNames) && existingPayload.pdfFileNames.length > 0
      ? existingPayload.pdfFileNames
      : (existing.pdf_file_names && existing.pdf_file_names.length > 0
          ? existing.pdf_file_names
          : (existingPayload.pdfFileName ? [existingPayload.pdfFileName] : []))

    // Which "part" is this new PDF? Derive from whatever provenance the saved
    // payload carries — filename count, or the highest part index already used.
    const maxTaskPart = existingTasks.reduce((m, t) => Math.max(m, Number(t?.video_index) || 1), 1)
    const maxLinePart = existingTranscript.reduce((m, l) => Math.max(m, Number(l?.v) || 1), 1)
    const existingPartCount = Math.max(existingFileNames.length, maxTaskPart, maxLinePart, 1)
    const partIndex = existingPartCount + 1
    console.log(`[pdf-append] Adding PDF part ${partIndex} ("${file.name}") to extraction ${id}`)

    // Reference data for the AI prompt, plus the anti-dup context.
    const dbCtx = await getDBContext()
    const dbContextString = formatDBContextForPrompt(dbCtx)
    const analysisContext = withExistingTasksContext(dbContextString, existingTasks)

    // Parse the new PDF → ordered blocks with attached images/Loom URLs.
    const buf = Buffer.from(await file.arrayBuffer())
    const parsed = await parsePdfToBlocks(buf)
    console.log(`[pdf-append] Parsed ${parsed.pageCount} pages → ${parsed.stats.textBlocks} text blocks, ${parsed.stats.images} images, ${parsed.stats.loomUrls} Loom URLs`)
    if (parsed.blocks.length === 0) {
      return NextResponse.json({ error: 'No text content found in the new PDF.' }, { status: 400 })
    }

    const blocksForAI: PdfBlockForAI[] = parsed.blocks.map(b => ({
      index: b.index,
      page: b.page,
      firstLine: b.firstLine,
      text: b.text,
      hasImages: b.images.length > 0,
      hasLoomUrls: b.loomUrls.length > 0,
    }))

    console.log(`[pdf-append] Analyzing ${blocksForAI.length} new blocks with AI...`)
    const aiTasks = await analyzePdfBlocksWithAI(blocksForAI, analysisContext)
    if (aiTasks.length === 0) {
      return NextResponse.json({ error: 'No new tasks could be identified in this PDF.' }, { status: 400 })
    }

    // Re-attach the source block's images + Loom URLs to each new task.
    const blockByIndex = new Map<number, PdfBlock>()
    for (const b of parsed.blocks) blockByIndex.set(b.index, b)

    const newTasks = aiTasks.map((t, i) => {
      const block = blockByIndex.get(t.source_block_index)
      const screenshots = (block?.images || []).map((dataUrl, si) => ({
        timestamp_seconds: 0,
        timestamp_label: `Image ${si + 1}`,
        image_url: '',
        image_base64: dataUrl,
      }))
      const primary = screenshots[0]
      const loomUrl = block?.loomUrls?.[0] || ''
      return {
        ...t,
        // Namespaced so it can't collide with the existing pdf_<n> ids.
        _id: `pdf_p${partIndex}_${i}`,
        timestamp_seconds: 0,
        timestamp_label: '',
        screenshot_timestamps: [],
        image_url: primary?.image_url || '',
        image_base64: primary?.image_base64 || '',
        screenshots,
        loom_url: loomUrl,
        source: 'pdf' as const,
        // Reuse video_index as a generic "part" pointer so the results page's
        // existing multi-part rendering picks it up (labelled "PDF N" for PDFs).
        video_index: partIndex,
        source_block_index: t.source_block_index,
        source_block_page: block?.page ?? null,
      }
    })
    console.log(`[pdf-append] AI identified ${newTasks.length} new task(s) for part ${partIndex}`)

    // Merge into the existing payload.
    const mergedTasks = [...existingTasks, ...newTasks]
    const mergedTranscript = [
      ...existingTranscript,
      ...parsed.blocks.map(b => ({ t: `p${b.page}`, s: b.text, v: partIndex })),
    ]
    const mergedFileNames = [...existingFileNames, file.name]

    // Regenerate the combined summary over ALL accumulated block text so the
    // narrative reflects every part. Reconstruct a minimal block view from the
    // merged transcript (generatePdfSummary only needs index + text). Non-fatal.
    let mergedSummary: string = existingPayload.summary || existing.summary || ''
    try {
      const combinedBlocks: PdfBlockForAI[] = mergedTranscript.map((l: any, i: number) => ({
        index: i,
        page: 0,
        firstLine: '',
        text: l.s,
        hasImages: false,
        hasLoomUrls: false,
      }))
      const regenerated = await generatePdfSummary(combinedBlocks)
      if (regenerated && regenerated.trim()) mergedSummary = regenerated.trim()
    } catch (summaryErr: any) {
      console.warn('[pdf-append] combined summary regeneration failed (non-fatal):', summaryErr?.message || summaryErr)
    }

    const mergedPayload = {
      ...existingPayload,
      success: true,
      source: 'pdf' as const,
      videoId: existingPayload.videoId || '',
      loomUrl: '',
      videoIds: [],
      loomUrls: [],
      videoCount: 0,
      summary: mergedSummary,
      tasks: mergedTasks,
      totalTasks: mergedTasks.length,
      transcript: mergedTranscript,
      pdfFileName: existingFileNames[0] || file.name,
      pdfFileNames: mergedFileNames,
      pdfPartCount: mergedFileNames.length,
    }

    await updateExtractionResult(id, {
      loomUrls: [],
      videoIds: [],
      pdfFileNames: mergedFileNames,
      itemCount: mergedTasks.length,
      summary: mergedSummary,
      title: existing.title,
      payload: mergedPayload,
    })

    return NextResponse.json({ ...mergedPayload, id })
  } catch (error: any) {
    console.error('[pdf-append] Error appending PDF:', error)
    return NextResponse.json(
      {
        error: error?.message || 'An error occurred while appending the PDF',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 },
    )
  }
}
