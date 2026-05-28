import { NextRequest, NextResponse } from 'next/server'
import { downloadLoomVideo, downloadLoomSubtitles, cleanupVideo } from '@/lib/videoDownloader'
import { extractFrame, secondsToTimestamp, validateVideoFile } from '@/lib/frameExtractor'
import { parseSubtitleFile, extractLoomVideoId, generateLoomUrlWithTimestamp } from '@/lib/transcriptParser'
import { analyzeTranscriptWithAI } from '@/lib/aiProviders'
import { getDBContext, formatDBContextForPrompt } from '@/lib/dbContext'
import { getExtractionResult, updateExtractionResult } from '@/lib/resultsDb'
import * as path from 'path'
import * as fs from 'fs'

export const maxDuration = 800 // ~13 minutes — append flow downloads + transcribes one more video

export async function POST(request: NextRequest) {
  let videoPath: string | null = null
  let subtitlePath: string | null = null

  // Ensure runtime directories exist (Railway ephemeral filesystem)
  for (const dir of [
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'temp'),
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'public', 'temp', 'frames'),
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  try {
    const body = await request.json()
    const { id, loomUrl } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'extraction id is required' }, { status: 400 })
    }
    if (!loomUrl || typeof loomUrl !== 'string') {
      return NextResponse.json({ error: 'loomUrl is required' }, { status: 400 })
    }

    const newVideoId = extractLoomVideoId(loomUrl.trim())
    if (!newVideoId) {
      return NextResponse.json({ error: 'Invalid Loom URL format' }, { status: 400 })
    }

    // Load the existing extraction we'll be appending to.
    const existing = await getExtractionResult(id)
    if (!existing) {
      return NextResponse.json({ error: `Extraction ${id} not found` }, { status: 404 })
    }
    if (existing.mode !== 'task') {
      return NextResponse.json({ error: 'Append is only supported for task-mode extractions' }, { status: 400 })
    }

    const existingPayload = existing.payload || {}
    // Fall back to the legacy singular fields if the saved row predates multi-video.
    const existingLoomUrls: string[] = Array.isArray(existingPayload.loomUrls) && existingPayload.loomUrls.length > 0
      ? existingPayload.loomUrls
      : (existing.loom_url ? [existing.loom_url] : [])
    const existingVideoIds: string[] = Array.isArray(existingPayload.videoIds) && existingPayload.videoIds.length > 0
      ? existingPayload.videoIds
      : (existing.video_id ? [existing.video_id] : [])
    const existingTasks: any[] = Array.isArray(existingPayload.tasks) ? existingPayload.tasks : []
    const existingTranscript: Array<{ t: string; s: string; v?: number }> =
      Array.isArray(existingPayload.transcript) ? existingPayload.transcript : []

    if (existingLoomUrls.includes(loomUrl.trim())) {
      return NextResponse.json(
        { error: `This Loom URL is already part of the extraction (Vid ${existingLoomUrls.indexOf(loomUrl.trim()) + 1})` },
        { status: 409 },
      )
    }

    const newVideoIndex = Math.max(existingLoomUrls.length, existingVideoIds.length) + 1
    console.log(`[append] Adding Vid ${newVideoIndex} (${newVideoId}) to extraction ${id}`)

    // DB reference data — needed by the AI prompt
    const dbCtx = await getDBContext()
    const dbContextString = formatDBContextForPrompt(dbCtx)

    // Download the new video + transcript.
    const { videoPath: downloadedVideoPath } = await downloadLoomVideo(loomUrl.trim())
    videoPath = downloadedVideoPath

    let newEntries: any[]
    try {
      const subtitleResult = await downloadLoomSubtitles(loomUrl.trim())
      subtitlePath = subtitleResult.path
      newEntries = parseSubtitleFile(subtitleResult.path, subtitleResult.format)
      console.log(`[append] Extracted ${newEntries.length} transcript entries (format: ${subtitleResult.format})`)
    } catch (error) {
      console.error(`[append] Error fetching transcript for new video:`, error)
      const baseMsg = error instanceof Error ? error.message : String(error)
      return NextResponse.json(
        { error: `Failed to extract transcript for the new Loom video: ${baseMsg}` },
        { status: 400 },
      )
    }
    if (newEntries.length === 0) {
      return NextResponse.json({ error: 'No transcript entries found in the new video' }, { status: 400 })
    }
    for (const e of newEntries) e.video_index = newVideoIndex

    // Pre-flight: confirm the downloaded mp4 is decodable before we spend AI tokens.
    const videoIssue = await validateVideoFile(videoPath)
    if (videoIssue) {
      throw new Error(`Downloaded video is not usable for frame extraction: ${videoIssue}`)
    }

    // Analyze ONLY the new transcript. The AI sees a single VIDEO N block, so
    // it tags returned tasks with video_index = newVideoIndex via the multi-video
    // prompt. Cheaper than re-analyzing every existing video and the existing
    // tasks stay untouched.
    console.log(`[append] AI-analyzing new transcript...`)
    const newTasks = await analyzeTranscriptWithAI(newEntries, dbContextString)
    console.log(`[append] AI identified ${newTasks.length} new task(s)`)

    // Frame extraction for the new tasks against the new video file.
    const processedNewTasks: any[] = []
    for (let i = 0; i < newTasks.length; i++) {
      const task: any = newTasks[i]
      const taskVideoIndex = (Number(task.video_index) >= 1) ? Math.floor(Number(task.video_index)) : newVideoIndex
      // All AI output for an append run belongs to the new video.
      task.video_index = newVideoIndex

      try {
        console.log(`[append] Processing task ${i + 1}/${newTasks.length}: ${task.task_name}`)
        const timestampsToCapture: number[] = task.screenshot_timestamps && task.screenshot_timestamps.length > 0
          ? task.screenshot_timestamps
          : [task.timestamp_seconds]

        const screenshots: any[] = []
        for (let j = 0; j < timestampsToCapture.length; j++) {
          const ts = timestampsToCapture[j]
          if (j > 0) await new Promise(resolve => setTimeout(resolve, 500))
          try {
            const tsLabel = secondsToTimestamp(ts)
            const framePath = await extractFrame({ videoPath: videoPath!, timestampSeconds: ts, timestampLabel: tsLabel })
            const relativeFramePath = path.relative(path.join(process.cwd(), 'public'), framePath)
            const imageUrl = '/' + relativeFramePath.replace(/\\/g, '/')

            let base64Image = ''
            try {
              const imageBuffer = fs.readFileSync(framePath)
              base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
              try { fs.unlinkSync(framePath) } catch {}
            } catch (base64Error) {
              console.error('[append] Failed to create base64:', base64Error)
            }

            screenshots.push({
              timestamp_seconds: ts,
              timestamp_label: tsLabel,
              image_url: imageUrl,
              image_base64: base64Image,
            })
          } catch (frameErr: any) {
            console.error(`[append] Frame error at ${ts}s: ${frameErr?.message || frameErr}`)
          }
        }

        const primary = screenshots[0]
        processedNewTasks.push({
          ...task,
          video_index: taskVideoIndex,
          image_url: primary?.image_url || '',
          image_base64: primary?.image_base64 || '',
          screenshots,
          loom_url: generateLoomUrlWithTimestamp(newVideoId, task.timestamp_seconds),
        })
      } catch (taskErr) {
        console.error(`[append] Error processing task ${i + 1}:`, taskErr)
        processedNewTasks.push({
          ...task,
          image_url: '',
          loom_url: generateLoomUrlWithTimestamp(newVideoId, task.timestamp_seconds),
        })
      }
    }

    // Merge into the existing payload.
    const mergedLoomUrls = [...existingLoomUrls, loomUrl.trim()]
    const mergedVideoIds = [...existingVideoIds, newVideoId]
    const mergedTasks = [...existingTasks, ...processedNewTasks]
    const mergedTranscript = [
      ...existingTranscript,
      ...newEntries.map((e: any) => ({ t: e.timestamp_label, s: e.text, v: newVideoIndex })),
    ]

    const mergedPayload = {
      success: true,
      // Keep legacy singular fields aligned with the first video for back-compat.
      videoId: existingVideoIds[0] || newVideoId,
      loomUrl: existingLoomUrls[0] || loomUrl.trim(),
      videoIds: mergedVideoIds,
      loomUrls: mergedLoomUrls,
      videoCount: mergedLoomUrls.length,
      summary: existingPayload.summary || '',
      tasks: mergedTasks,
      totalTasks: mergedTasks.length,
      transcript: mergedTranscript,
    }

    // Persist back to the same DB row. id stays stable so /result/[id] URLs continue to work.
    await updateExtractionResult(id, {
      loomUrls: mergedLoomUrls,
      videoIds: mergedVideoIds,
      itemCount: mergedTasks.length,
      summary: existingPayload.summary || existing.summary,
      title: existing.title,
      payload: mergedPayload,
    })

    cleanupVideo(videoPath)
    videoPath = null

    return NextResponse.json({ ...mergedPayload, id })
  } catch (error: any) {
    console.error('[append] Error appending Loom video:', error)
    if (videoPath) cleanupVideo(videoPath)
    return NextResponse.json(
      {
        error: error.message || 'An error occurred while appending the video',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 },
    )
  } finally {
    if (subtitlePath) {
      try { fs.unlinkSync(subtitlePath) } catch {}
    }
  }
}
