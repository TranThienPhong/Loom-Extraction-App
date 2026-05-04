import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'

const execAsync = promisify(exec)

export interface FrameExtractionOptions {
  videoPath: string
  timestampSeconds: number
  timestampLabel?: string
  outputDir?: string
}

/**
 * Check if ffmpeg is installed
 */
async function checkFfmpegInstalled(): Promise<boolean> {
  try {
    await execAsync('which ffmpeg')
    return true
  } catch {
    return false
  }
}

/**
 * Extracts a frame from a video at a specific timestamp using ffmpeg
 * Requires ffmpeg to be installed on the system
 * Install: sudo apt-get install ffmpeg (Ubuntu/Debian) or brew install ffmpeg (macOS)
 */
export async function extractFrame(options: FrameExtractionOptions): Promise<string> {
  // Check if ffmpeg is installed
  const ffmpegInstalled = await checkFfmpegInstalled()
  if (!ffmpegInstalled) {
    throw new Error(
      'ffmpeg is not installed. Please install it first:\n\n' +
      'Ubuntu/Debian: sudo apt-get update && sudo apt-get install ffmpeg\n' +
      'macOS: brew install ffmpeg\n\n' +
      'Or run: ./check-dependencies.sh for more information.'
    )
  }

  const { videoPath, timestampSeconds, outputDir } = options

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  // Create output directory (CRITICAL: Railway needs this!)
  // @ts-ignore - turbopack ignore: dynamic path only used at runtime
  const frameDir = outputDir || path.join(/*turbopackIgnore: true*/ process.cwd(), 'public', 'temp', 'frames')
  
  // Ensure parent directories exist
  const publicDir = path.join(process.cwd(), 'public')
  const tempDir = path.join(publicDir, 'temp')
  
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true })
    console.log('Created public directory')
  }
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
    console.log('Created temp directory')
  }
  if (!fs.existsSync(frameDir)) {
    fs.mkdirSync(frameDir, { recursive: true })
    console.log(`Created frames directory: ${frameDir}`)
  }

  // Generate unique filename
  const videoBasename = path.basename(videoPath, path.extname(videoPath))
  const framePath = path.join(frameDir, `${videoBasename}_${timestampSeconds}s.jpg`)

  // Check if frame already exists
  if (fs.existsSync(framePath)) {
    console.log('Frame already extracted, using cached version')
    return framePath
  }

  // Retry logic with exponential backoff (for Railway resource issues)
  const maxRetries = 3
  let lastError: Error | null = null
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Extract frame using ffmpeg (simple extraction without overlay)
      // -ss: seek to timestamp
      // -i: input file
      // -vframes 1: extract one frame
      // -q:v 2: high quality (1-31, lower is better)
      // Note: Timestamps are added via CSS overlays on the frontend
      
      const command = `ffmpeg -ss ${timestampSeconds} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`
      
      await execAsync(command, {
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer
        timeout: 30000, // 30 second timeout per frame
      })
      
      // Verify file exists and has content
      const stats = fs.statSync(framePath)
      
      if (stats.size === 0) {
        throw new Error('Frame file was created but is empty - ffmpeg may have failed')
      }
      
      // Success!
      if (attempt > 1) {
        console.log(`  ✓ Frame extraction succeeded on attempt ${attempt}`)
      }
      return framePath
      
    } catch (error: any) {
      lastError = error
      
      // Check if it's a resource error that might benefit from retry
      const isResourceError = error.message.includes('Resource temporarily unavailable') || 
                             error.message.includes('pthread_create')
      
      if (isResourceError && attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000 // Exponential backoff: 2s, 4s, 8s
        console.log(`  ⚠️  Resource error on attempt ${attempt}/${maxRetries}, retrying in ${delayMs}ms...`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      } else if (attempt < maxRetries) {
        console.log(`  ⚠️  Error on attempt ${attempt}/${maxRetries}, retrying...`)
        await new Promise(resolve => setTimeout(resolve, 1000)) // 1s delay for other errors
      } else {
        console.error(`  ❌ All ${maxRetries} attempts failed for frame at ${timestampSeconds}s`)
      }
    }
  }
  
  // All retries exhausted
  throw new Error(`Failed to extract frame at ${timestampSeconds}s after ${maxRetries} attempts: ${lastError?.message}`)
}

/**
 * Convert timestamp string (e.g., "1:23", "0:45") to seconds
 */
export function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map(p => parseInt(p, 10))
  
  if (parts.length === 2) {
    // Format: MM:SS
    return parts[0] * 60 + parts[1]
  } else if (parts.length === 3) {
    // Format: HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  
  throw new Error(`Invalid timestamp format: ${timestamp}`)
}

/**
 * Convert seconds to timestamp string (MM:SS)
 */
export function secondsToTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Clean up extracted frames
 */
export function cleanupFrames(frameDir?: string): void {
  // @ts-ignore - turbopack ignore: dynamic path only used at runtime
  const dir = frameDir || path.join(/*turbopackIgnore: true*/ process.cwd(), 'public', 'temp', 'frames')
  
  try {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir)
      files.forEach(file => {
        fs.unlinkSync(path.join(dir, file))
      })
      console.log(`Cleaned up ${files.length} frame(s)`)
    }
  } catch (error) {
    console.error('Error cleaning up frames:', error)
  }
}
