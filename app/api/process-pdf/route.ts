import { NextRequest, NextResponse } from 'next/server'
import { parsePdfToBlocks, PdfBlock } from '@/lib/pdfParser'
import { analyzePdfBlocksWithAI, generatePdfSummary, PdfBlockForAI } from '@/lib/aiProviders'
import { getDBContext, formatDBContextForPrompt } from '@/lib/dbContext'
import { saveExtractionResult } from '@/lib/resultsDb'

export const maxDuration = 300 // 5 minutes — PDF parsing + AI is fast vs. video

/**
 * PDF-Upload variant of the task extractor. Accepts a multipart upload, parses
 * the PDF into ordered blocks (text + attached images + attached Loom URLs per
 * the "image follows text" rule), runs AI to convert blocks to tasks, and
 * returns the same payload shape as /api/process-loom so the results page
 * renders without any source-aware branching.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing PDF file (field name: "file")' }, { status: 400 })
    }
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Uploaded file must be a PDF' }, { status: 400 })
    }

    console.log(`[process-pdf] Received "${file.name}" (${file.size} bytes)`)

    // Step 0: Reference data for the AI prompt.
    const dbCtx = await getDBContext()
    const dbContextString = formatDBContextForPrompt(dbCtx)

    // Step 1: Parse PDF → ordered blocks with attached images/Loom URLs.
    const buf = Buffer.from(await file.arrayBuffer())
    const parsed = await parsePdfToBlocks(buf)
    console.log(`[process-pdf] Parsed ${parsed.pageCount} pages → ${parsed.stats.textBlocks} text blocks, ${parsed.stats.images} images, ${parsed.stats.loomUrls} Loom URLs`)

    if (parsed.blocks.length === 0) {
      return NextResponse.json({ error: 'No text content found in the PDF.' }, { status: 400 })
    }

    // Build the AI-facing slim view (no image bytes — saves tokens and the AI
    // doesn't need them; it just needs to know which blocks have attachments).
    const blocksForAI: PdfBlockForAI[] = parsed.blocks.map(b => ({
      index: b.index,
      page: b.page,
      firstLine: b.firstLine,
      text: b.text,
      hasImages: b.images.length > 0,
      hasLoomUrls: b.loomUrls.length > 0,
    }))

    // Step 2: Sequential AI calls — tasks first, then summary. Same reasoning
    // as the Loom route: parallel calls double the concurrent Anthropic load.
    console.log(`[process-pdf] Analyzing ${blocksForAI.length} blocks with AI...`)
    const aiTasks = await analyzePdfBlocksWithAI(blocksForAI, dbContextString)
    let summary = ''
    try {
      summary = await generatePdfSummary(blocksForAI)
    } catch (e: any) {
      console.warn('[process-pdf] Summary generation failed (non-fatal):', e?.message || e)
    }

    if (aiTasks.length === 0) {
      return NextResponse.json({ error: 'No tasks could be identified in the PDF.' }, { status: 400 })
    }

    // Step 3: Re-attach the source block's images + Loom URLs to each task.
    // Build a quick lookup by block index.
    const blockByIndex = new Map<number, PdfBlock>()
    for (const b of parsed.blocks) blockByIndex.set(b.index, b)

    const tasks = aiTasks.map((t, i) => {
      const block = blockByIndex.get(t.source_block_index)
      const screenshots = (block?.images || []).map((dataUrl, si) => ({
        // PDF has no video timestamp — use zero/empty so the results page can
        // distinguish PDF screenshots from video screenshots if it wants to.
        timestamp_seconds: 0,
        timestamp_label: `Image ${si + 1}`,
        image_url: '',
        image_base64: dataUrl,
      }))
      const primary = screenshots[0]
      // First attached Loom URL becomes the "Watch in Loom" link; the rest are
      // dropped (the schema only carries one). Could expand later if needed.
      const loomUrl = block?.loomUrls?.[0] || ''

      return {
        ...t,
        // Stable identity so the results-page React keys behave.
        _id: `pdf_${i}`,
        // Synthetic timestamp fields for shape compatibility with the Loom flow.
        timestamp_seconds: 0,
        timestamp_label: '',
        screenshot_timestamps: [],
        // Primary screenshot + array of all screenshots.
        image_url: primary?.image_url || '',
        image_base64: primary?.image_base64 || '',
        screenshots,
        loom_url: loomUrl,
        // PDF-specific provenance — lets the UI hide video-only affordances.
        source: 'pdf' as const,
        source_block_index: t.source_block_index,
        source_block_page: block?.page ?? null,
      }
    })

    const responseData = {
      success: true,
      source: 'pdf' as const,
      // PDF flow has no video — keep these fields present and empty so the
      // results page's existing reads (`data.videoId`, `data.loomUrls`) don't blow up.
      videoId: '',
      loomUrl: '',
      videoIds: [],
      loomUrls: [],
      videoCount: 0,
      summary: summary || '',
      tasks,
      totalTasks: tasks.length,
      // Transcript section on the results page renders the source text grouped
      // by block — gives the user a sense of what the PDF said.
      transcript: parsed.blocks.map(b => ({ t: `p${b.page}`, s: b.text })),
      // Original filename for display.
      pdfFileName: file.name,
      pdfPageCount: parsed.pageCount,
    }

    // Persist to history.
    let resultId: string | null = null
    try {
      const r = await saveExtractionResult({
        mode: 'task',
        source: 'pdf',
        title: file.name.replace(/\.pdf$/i, '').slice(0, 120),
        summary: summary || null,
        videoId: null,
        loomUrl: null,
        videoIds: [],
        loomUrls: [],
        itemCount: tasks.length,
        payload: responseData,
      })
      resultId = r.id
    } catch (saveErr: any) {
      console.warn('[process-pdf] history save failed:', saveErr?.message || saveErr)
    }

    // For IndexedDB keying on the client (storeProcessingResults uses videoId
    // as its primary key), use the result id when present. Two PDF uploads
    // would otherwise both use videoId='' and collide.
    const clientStorageKey = resultId ? `pdf_${resultId}` : `pdf_${Date.now()}`
    return NextResponse.json({ ...responseData, videoId: clientStorageKey, id: resultId })
  } catch (error: any) {
    console.error('[process-pdf] Error:', error)
    return NextResponse.json(
      {
        error: error?.message || 'An error occurred while processing the PDF',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 },
    )
  }
}
