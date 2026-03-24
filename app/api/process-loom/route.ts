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
    
    const tasksWithImages = await Promise.all(
      tasks.map(async (task, index) => {
        try {
          console.log(`Extracting frame ${index + 1}/${tasks.length} at ${task.timestamp_label}`)
          
          const framePath = await extractFrame({
            videoPath: videoPath!,
            timestampSeconds: task.timestamp_seconds,
            timestampLabel: task.timestamp_label,
          })

          // Convert to public URL path
          const relativeFramePath = path.relative(
            path.join(process.cwd(), 'public'),
            framePath
          )
          const imageUrl = '/' + relativeFramePath.replace(/\\/g, '/')

          return {
            ...task,
            image_url: imageUrl,
            loom_url: generateLoomUrlWithTimestamp(videoId, task.timestamp_seconds),
          }
        } catch (error) {
          console.error(`Error extracting frame for task ${index + 1}:`, error)
          // Return task without image if frame extraction fails
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
