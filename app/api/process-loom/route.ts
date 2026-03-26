import { NextRequest, NextResponse } from 'next/server'
import { downloadLoomVideo, downloadLoomSubtitles, cleanupVideo } from '@/lib/videoDownloader'
import { extractFrame, secondsToTimestamp } from '@/lib/frameExtractor'
import { parseManualTranscript, parseJsonSubtitles, extractLoomVideoId, generateLoomUrlWithTimestamp } from '@/lib/transcriptParser'
import { analyzeTranscriptWithAI } from '@/lib/aiProviders'
import * as path from 'path'
import * as fs from 'fs'

export const maxDuration = 300 // 5 minutes timeout for video processing

export async function POST(request: NextRequest) {
  let videoPath: string | null = null

  try {
    const body = await request.json()
    const { loomUrl, manualTranscript } = body

    if (!loomUrl) {
      return NextResponse.json(
        { error: 'Loom URL is required' },
        { status: 400 }
      )
    }

    // Extract video ID
    const videoId = extractLoomVideoId(loomUrl)
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid Loom URL format' },
        { status: 400 }
      )
    }

    console.log(`Processing Loom video: ${videoId}`)

    // Step 1: Download the video
    console.log('Step 1: Downloading video...')
    const { videoPath: downloadedVideoPath } = await downloadLoomVideo(loomUrl)
    videoPath = downloadedVideoPath

    // Step 2: Get transcript
    console.log('Step 2: Processing transcript...')
    let transcript

    if (manualTranscript && manualTranscript.trim()) {
      // Use manually pasted transcript
      console.log('Using manually pasted transcript')
      transcript = parseManualTranscript(manualTranscript)
    } else {
      // Automatic transcript extraction
      console.log('Downloading and parsing automatic transcript...')
      try {
        const subtitlePath = await downloadLoomSubtitles(loomUrl)
        transcript = parseJsonSubtitles(subtitlePath)
        console.log(`Automatically extracted ${transcript.length} transcript entries`)
      } catch (error) {
        console.error('Error with automatic transcript:', error)
        return NextResponse.json(
          { 
            error: `Failed to automatically extract transcript: ${error instanceof Error ? error.message : String(error)}. Please check "Paste transcript manually" and provide the transcript.`,
            needsManualTranscript: true 
          },
          { status: 400 }
        )
      }
    }

    if (transcript.length === 0) {
      return NextResponse.json(
        { error: 'No valid transcript entries found' },
        { status: 400 }
      )
    }

    console.log(`Parsed ${transcript.length} transcript entries`)

    // Step 3: Analyze transcript with AI
    console.log('Step 3: Analyzing transcript with AI...')
    const tasks = await analyzeTranscriptWithAI(transcript)

    if (tasks.length === 0) {
      return NextResponse.json(
        { error: 'No tasks found in the transcript. The video may not contain any change requests or feedback.' },
        { status: 400 }
      )
    }

    console.log(`AI identified ${tasks.length} tasks`)

    // Step 4: Extract frames for each task
    console.log('Step 4: Extracting video frames...')
    
    // Ensure videoPath is not null before proceeding
    if (!videoPath) {
      throw new Error('Video path is not set')
    }
    
    // Helper function to limit concurrency (prevent Railway resource exhaustion)
    const processWithConcurrencyLimit = async <T, R>(
      items: T[],
      limit: number,
      fn: (item: T) => Promise<R>
    ): Promise<R[]> => {
      const results: R[] = []
      for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit)
        const batchResults = await Promise.all(batch.map(fn))
        results.push(...batchResults)
      }
      return results
    }
    
    const tasksWithImages = await Promise.all(
      tasks.map(async (task, index) => {
        try {
          console.log(`Processing task ${index + 1}/${tasks.length}: ${task.task_name}`)
          
          // Extract multiple frames if screenshot_timestamps is provided
          const timestampsToCapture = task.screenshot_timestamps && task.screenshot_timestamps.length > 0
            ? task.screenshot_timestamps
            : [task.timestamp_seconds] // Fallback to primary timestamp
          
          console.log(`Capturing ${timestampsToCapture.length} screenshot(s) for task ${index + 1}`)
          
          // CRITICAL: Limit concurrent ffmpeg processes to 3 to prevent Railway resource exhaustion
          const screenshots = await processWithConcurrencyLimit(
            timestampsToCapture,
            3, // Max 3 concurrent frame extractions
            async (timestampSeconds) => {
              try {
                const timestampLabel = secondsToTimestamp(timestampSeconds)
                
                const framePath = await extractFrame({
                  videoPath: videoPath!,
                  timestampSeconds,
                  timestampLabel,
                })
                
                // Convert to public URL path
                const relativeFramePath = path.relative(
                  path.join(process.cwd(), 'public'),
                  framePath
                )
                const imageUrl = '/' + relativeFramePath.replace(/\\/g, '/')
                
                // For Railway/production: Create base64 fallback
                let base64Image = ''
                try {
                  const imageBuffer = fs.readFileSync(framePath)
                  base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                } catch (base64Error) {
                  console.error('  - ❌ Failed to create base64:', base64Error)
                }

                return {
                  timestamp_seconds: timestampSeconds,
                  timestamp_label: timestampLabel,
                  image_url: imageUrl,
                  image_base64: base64Image,
                }
              } catch (error) {
                console.error(`  - ❌ ERROR at ${timestampSeconds}s`)
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
            loom_url: generateLoomUrlWithTimestamp(videoId, task.timestamp_seconds),
          }
        } catch (error) {
          console.error(`Error processing task ${index + 1}:`, error)
          // Return task without images if extraction fails
          return {
            ...task,
            image_url: '',
            loom_url: generateLoomUrlWithTimestamp(videoId, task.timestamp_seconds),
          }
        }
      })
    )

    console.log('Processing complete!')

    // Note: We keep the video file for potential re-processing
    // You can implement cleanup logic based on your needs

    return NextResponse.json({
      success: true,
      videoId,
      tasks: tasksWithImages,
      totalTasks: tasksWithImages.length,
    })
  } catch (error: any) {
    console.error('Error processing Loom video:', error)
    
    // Cleanup on error
    if (videoPath) {
      cleanupVideo(videoPath)
    }

    return NextResponse.json(
      { 
        error: error.message || 'An error occurred while processing the video',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}
