import { NextRequest, NextResponse } from 'next/server'
import { downloadLoomVideo, downloadLoomSubtitles, cleanupVideo } from '@/lib/videoDownloader'
import { extractFrame, secondsToTimestamp, validateVideoFile } from '@/lib/frameExtractor'
import { parseManualTranscript, parseSubtitleFile, extractLoomVideoId, generateLoomUrlWithTimestamp } from '@/lib/transcriptParser'
import { analyzeTranscriptWithAI, generateVideoSummary } from '@/lib/aiProviders'
import { getDBContext, formatDBContextForPrompt } from '@/lib/dbContext'
import { saveExtractionResult } from '@/lib/resultsDb'
import * as path from 'path'
import * as fs from 'fs'

export const maxDuration = 800 // ~13 minutes - supports long videos (30+ min)

export async function POST(request: NextRequest) {
  // Per-video temp files we must clean up no matter how the request ends.
  const videoPaths: string[] = []
  const subtitlePaths: string[] = []

  // Ensure runtime directories exist (Railway ephemeral filesystem)
  for (const dir of [
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'temp'),
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'public', 'temp', 'frames'),
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  try {
    const body = await request.json()
    const { loomUrl, loomUrls: bodyLoomUrls, manualTranscript } = body

    // Accept either the new `loomUrls` array or the legacy single `loomUrl`.
    // Strip blanks (empty rows from the multi-URL UI) and de-dupe.
    const rawUrls: string[] = Array.isArray(bodyLoomUrls)
      ? bodyLoomUrls
      : (loomUrl ? [loomUrl] : [])
    const loomUrls = Array.from(new Set(rawUrls.map((u: string) => (u || '').trim()).filter(Boolean)))

    if (loomUrls.length === 0) {
      return NextResponse.json(
        { error: 'At least one Loom URL is required' },
        { status: 400 }
      )
    }

    // Manual transcript pairs with a single video — combining a hand-pasted
    // transcript with multiple videos has no sensible mapping.
    if (manualTranscript && manualTranscript.trim() && loomUrls.length > 1) {
      return NextResponse.json(
        { error: 'Manual transcript can only be used with a single Loom URL. Remove the extra URLs or clear the manual transcript.' },
        { status: 400 }
      )
    }

    // Validate every URL up-front so the user gets one combined error instead
    // of partial progress from downloading some videos before finding the bad one.
    const videoIds = loomUrls.map(u => extractLoomVideoId(u))
    const badIdx = videoIds.findIndex(v => !v)
    if (badIdx !== -1) {
      return NextResponse.json(
        { error: `Invalid Loom URL format (URL #${badIdx + 1}): ${loomUrls[badIdx]}` },
        { status: 400 }
      )
    }
    const safeVideoIds = videoIds as string[]

    console.log(`Processing ${loomUrls.length} Loom video(s): ${safeVideoIds.join(', ')}`)

    // Step 0: Fetch DB reference data FIRST (names only — before any heavy processing)
    console.log('Step 0: Loading DB reference data...')
    const dbCtx = await getDBContext()
    const dbContextString = formatDBContextForPrompt(dbCtx)

    // Step 1 + 2: Sequentially download each video and its transcript.
    // Sequential, not parallel: yt-dlp + the transcript download both saturate
    // the network/disk and concurrent runs on the same host trip Railway's
    // resource limits. Order matters — videos are labeled Vid 1..N in submit order.
    const videoTranscripts: Array<{ url: string; videoId: string; transcript: any[] }> = []

    for (let i = 0; i < loomUrls.length; i++) {
      const url = loomUrls[i]
      const vid = safeVideoIds[i]
      const videoIndex = i + 1

      console.log(`Step 1.${videoIndex}: Downloading video ${videoIndex}/${loomUrls.length} (${vid})...`)
      const { videoPath: downloadedVideoPath } = await downloadLoomVideo(url)
      videoPaths.push(downloadedVideoPath)

      console.log(`Step 2.${videoIndex}: Processing transcript for video ${videoIndex}/${loomUrls.length}...`)
      let entries: any[]

      // Manual transcript is only allowed with one URL (gated above), so this
      // branch only fires when loomUrls.length === 1.
      if (manualTranscript && manualTranscript.trim()) {
        console.log('Using manually pasted transcript')
        entries = parseManualTranscript(manualTranscript)
      } else {
        try {
          const subtitleResult = await downloadLoomSubtitles(url)
          subtitlePaths.push(subtitleResult.path)
          entries = parseSubtitleFile(subtitleResult.path, subtitleResult.format)
          console.log(`  Extracted ${entries.length} transcript entries (format: ${subtitleResult.format})`)
        } catch (error) {
          console.error(`Error with automatic transcript for video ${videoIndex}:`, error)
          const baseMsg = error instanceof Error ? error.message : String(error)
          const msg = loomUrls.length > 1
            ? `Failed to automatically extract transcript for video ${videoIndex} (${vid}): ${baseMsg}. Multi-video extractions require automatic transcripts.`
            : `Failed to automatically extract transcript: ${baseMsg}. Please check "Paste transcript manually" and provide the transcript.`
          return NextResponse.json(
            { error: msg, needsManualTranscript: loomUrls.length === 1 },
            { status: 400 }
          )
        }
      }

      // Tag each entry with which video it belongs to so the AI prompt and the
      // results page can render Vid N markers.
      for (const e of entries) e.video_index = videoIndex

      videoTranscripts.push({ url, videoId: vid, transcript: entries })
    }

    // Combine in submit order. Each entry already carries its video_index.
    const transcript = videoTranscripts.flatMap(v => v.transcript)

    if (transcript.length === 0) {
      return NextResponse.json(
        { error: 'No valid transcript entries found across the submitted videos' },
        { status: 400 }
      )
    }

    console.log(`Parsed ${transcript.length} total transcript entries across ${loomUrls.length} video(s)`)

    // Step 3: Analyze transcript with AI.
    // Sequential, not parallel: doing tasks + summary in parallel doubles the
    // concurrent Anthropic load and was triggering 529 overloads. Tasks are
    // load-bearing; summary is cosmetic, so do tasks first and never let a
    // summary failure block the response.
    console.log('Step 3: Analyzing transcript with AI...')
    const tasks = await analyzeTranscriptWithAI(transcript, dbContextString)
    let summary = ''
    try {
      summary = await generateVideoSummary(transcript)
      console.log(`AI summary: ${summary?.substring(0, 100)}...`)
    } catch (summaryErr: any) {
      console.warn('Summary generation failed (non-fatal):', summaryErr?.message || summaryErr)
    }

    if (tasks.length === 0) {
      return NextResponse.json(
        { error: 'No tasks found in the transcript. The video may not contain any change requests or feedback.' },
        { status: 400 }
      )
    }

    console.log(`AI identified ${tasks.length} tasks`)

    // Step 4: Extract frames for each task
    console.log('Step 4: Extracting video frames...')

    if (videoPaths.length === 0) {
      throw new Error('No video paths available — download step failed silently')
    }

    // Pre-flight: verify every downloaded video is decodable. yt-dlp can
    // occasionally produce a 0-byte or partial mp4 (e.g. interrupted HLS merge)
    // and without this we'd churn through every task × every timestamp before
    // failing with no signal about why.
    for (let i = 0; i < videoPaths.length; i++) {
      const issue = await validateVideoFile(videoPaths[i])
      if (issue) {
        throw new Error(`Downloaded video #${i + 1} (${safeVideoIds[i]}) is not usable for frame extraction: ${issue}`)
      }
    }
    
    // Helper function to limit concurrency (prevent Railway resource exhaustion)
    async function processWithConcurrencyLimit(
      items: any[],
      limit: number,
      fn: (item: any) => Promise<any>
    ): Promise<any[]> {
      const results: any[] = []
      for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit)
        const batchResults = await Promise.all(batch.map(fn))
        results.push(...batchResults)
      }
      return results
    }

    const processTaskItem = async ({ task, index }: { task: any; index: number }) => {
        // Resolve which source video this task came from. AI may omit video_index
        // on single-video runs — default to 1. Out-of-range values clamp to 1 so
        // we never index past the end of videoPaths.
        const rawVideoIndex = Number(task.video_index)
        const taskVideoIndex = (rawVideoIndex >= 1 && rawVideoIndex <= videoPaths.length)
          ? Math.floor(rawVideoIndex)
          : 1
        const taskVideoPath = videoPaths[taskVideoIndex - 1]
        const taskVideoId = safeVideoIds[taskVideoIndex - 1]
        // Normalize the field so downstream consumers (results page, history payload)
        // always see a valid 1-based index.
        task.video_index = taskVideoIndex

        try {
          console.log(`Processing task ${index + 1}/${tasks.length} (Vid ${taskVideoIndex}): ${task.task_name}`)

          // Extract multiple frames if screenshot_timestamps is provided
          const timestampsToCapture = task.screenshot_timestamps && task.screenshot_timestamps.length > 0
            ? task.screenshot_timestamps
            : [task.timestamp_seconds] // Fallback to primary timestamp

          console.log(`Capturing ${timestampsToCapture.length} screenshot(s) for task ${index + 1}`)

          // CRITICAL: Sequential processing (1 at a time) to prevent Railway resource exhaustion
          const screenshots = await processWithConcurrencyLimit(
            timestampsToCapture,
            1, // Max 1 concurrent frame extraction (prevents thread/memory exhaustion on Railway)
            async (timestampSeconds) => {
              try {
                // Add small delay between extractions to prevent Railway resource exhaustion
                if (timestampSeconds !== timestampsToCapture[0]) {
                  await new Promise(resolve => setTimeout(resolve, 500)) // 500ms delay
                }

                const timestampLabel = secondsToTimestamp(timestampSeconds)

                const framePath = await extractFrame({
                  videoPath: taskVideoPath,
                  timestampSeconds,
                  timestampLabel,
                })
                
                // Convert to public URL path
                const relativeFramePath = path.relative(
                  path.join(process.cwd(), 'public'),
                  framePath
                )
                const imageUrl = '/' + relativeFramePath.replace(/\\/g, '/')
                
                // For Railway/production: Create base64 fallback then delete frame from disk
                let base64Image = ''
                try {
                  const imageBuffer = fs.readFileSync(framePath)
                  base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                  // Delete frame from disk — base64 is embedded in the response
                  try { fs.unlinkSync(framePath) } catch {}
                } catch (base64Error) {
                  console.error('  - ❌ Failed to create base64:', base64Error)
                }

                return {
                  timestamp_seconds: timestampSeconds,
                  timestamp_label: timestampLabel,
                  image_url: imageUrl,
                  image_base64: base64Image,
                }
              } catch (error: any) {
                const msg = error?.message || String(error)
                console.error(`  - ❌ ERROR at ${timestampSeconds}s: ${msg}`)
                return null
              }
            }
          )

          // Filter out failed screenshots
          const validScreenshots = screenshots.filter(s => s !== null)
          
          console.log(`Successfully captured ${validScreenshots.length}/${timestampsToCapture.length} screenshots`)
          
          // CRITICAL: Log if we have NO valid screenshots
          if (validScreenshots.length === 0) {
            console.error(`❌ Task ${index + 1} has NO valid screenshots! Frame extraction failed completely.`)
          }

          // For backward compatibility, keep the first screenshot as primary image
          const primaryScreenshot = validScreenshots[0]
          
          // CRITICAL: Always include ALL screenshots (not just if > 1)
          // Frontend needs to know about screenshots even if there's only 1!
          const screenshotsToReturn = validScreenshots.length > 0 ? validScreenshots : []

          return {
            ...task,
            image_url: primaryScreenshot?.image_url || '',
            image_base64: primaryScreenshot?.image_base64 || '',
            screenshots: screenshotsToReturn, // CHANGED: Always return array, not undefined
            loom_url: generateLoomUrlWithTimestamp(taskVideoId, task.timestamp_seconds),
          }
        } catch (error) {
          console.error(`Error processing task ${index + 1}:`, error)
          // Return task without images if extraction fails
          return {
            ...task,
            image_url: '',
            loom_url: generateLoomUrlWithTimestamp(taskVideoId, task.timestamp_seconds),
          }
        }
    }

    const tasksWithImages = await processWithConcurrencyLimit(
      tasks.map((task: any, index: number) => ({ task, index })),
      1, // Process 1 task at a time — prevents OOM on Railway for long/large videos
      processTaskItem
    )

    console.log('Processing complete!')

    // Clean up every downloaded video — base64 images are already embedded in
    // the response so the mp4s on disk serve no further purpose.
    for (const p of videoPaths) cleanupVideo(p)

    const responseData = {
      success: true,
      // For back-compat with old result viewers that read these singular fields,
      // populate them with the first video. New consumers should prefer the arrays.
      videoId: safeVideoIds[0],
      loomUrl: loomUrls[0],
      videoIds: safeVideoIds,
      loomUrls,
      videoCount: loomUrls.length,
      summary: summary || '',
      tasks: tasksWithImages,
      totalTasks: tasksWithImages.length,
      transcript: transcript.map((e: any) => ({
        t: e.timestamp_label,
        s: e.text,
        v: e.video_index || 1,
      })),
    }

    // Persist to history (failure here must not break the user-facing flow).
    let resultId: string | null = null
    try {
      const r = await saveExtractionResult({
        mode: 'task',
        title: (summary || '').slice(0, 120) || null,
        summary: summary || null,
        videoId: safeVideoIds[0],
        loomUrl: loomUrls[0],
        videoIds: safeVideoIds,
        loomUrls,
        itemCount: tasksWithImages.length,
        payload: responseData,
      })
      resultId = r.id
    } catch (saveErr: any) {
      console.warn('[process-loom] history save failed:', saveErr?.message || saveErr)
    }

    return NextResponse.json({ ...responseData, id: resultId })
  } catch (error: any) {
    console.error('Error processing Loom video:', error)

    // Cleanup on error — best-effort for whichever videos managed to download.
    for (const p of videoPaths) cleanupVideo(p)

    return NextResponse.json(
      {
        error: error.message || 'An error occurred while processing the video',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  } finally {
    for (const p of subtitlePaths) {
      try { fs.unlinkSync(p) } catch {}
    }
  }
}
