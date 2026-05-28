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
 * Get the duration of a video file in seconds using ffprobe.
 * Returns null if it cannot be determined.
 */
export async function getVideoDuration(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { timeout: 15000 }
    )
    const dur = parseFloat(stdout.trim())
    return isNaN(dur) ? null : dur
  } catch {
    return null
  }
}

/**
 * Validate a video file is decodable before attempting frame extraction.
 * Returns a short diagnostic string when the file looks broken, null when OK.
 * Cheap to call: ffprobe just reads the container header.
 */
export async function validateVideoFile(videoPath: string): Promise<string | null> {
  if (!fs.existsSync(videoPath)) return `Video file not found: ${videoPath}`
  const stats = fs.statSync(videoPath)
  if (stats.size === 0) return `Video file is empty (0 bytes): ${videoPath}`
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_type,duration -of default=noprint_wrappers=1 "${videoPath}"`,
      { timeout: 15000 }
    )
    if (!stdout.includes('codec_type=video')) {
      return `Video file has no decodable video stream (size=${stats.size} bytes): ${videoPath}`
    }
    return null
  } catch (err: any) {
    return `ffprobe failed on video (size=${stats.size} bytes): ${err?.stderr?.toString?.().trim() || err?.message || err}`
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
  const publicDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'public')
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
  let lastError: any = null
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Accurate seek: pre-seek with -ss BEFORE -i to a nearby keyframe (fast),
      // then -ss AFTER -i to step forward to the exact frame. This avoids the
      // off-by-keyframe error where the screenshot showed the next/previous shot.
      const preSeek = Math.max(0, timestampSeconds - 2)
      const postSeek = timestampSeconds - preSeek
      const command = preSeek > 0
        ? `ffmpeg -y -ss ${preSeek} -i "${videoPath}" -ss ${postSeek} -frames:v 1 -q:v 2 -loglevel error "${framePath}"`
        : `ffmpeg -y -i "${videoPath}" -ss ${timestampSeconds} -frames:v 1 -q:v 2 -loglevel error "${framePath}"`
      
      const { stderr } = await execAsync(command, {
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        timeout: 90000, // 90 second timeout — long videos need more time
      })
      if (stderr && stderr.trim()) {
        console.warn(`  ffmpeg stderr at ${timestampSeconds}s:`, stderr.trim().substring(0, 200))
      }
      
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
      const msg: string = error?.stderr?.toString?.().trim() || error?.message || String(error)
      const shortMsg = msg.replace(/\s+/g, ' ').substring(0, 300)

      // Resource exhaustion is the only error class that retrying actually helps with.
      const isResourceError = msg.includes('Resource temporarily unavailable') ||
                             msg.includes('pthread_create')

      // These are deterministic — retrying with the same input will fail the same way.
      // Fail fast so the caller gets a clear diagnosis instead of a 3x delay.
      const isNonTransient =
        msg.includes('Invalid data found') ||
        msg.includes('moov atom not found') ||
        msg.includes('Invalid argument') ||
        msg.includes('No such file or directory') ||
        msg.includes('does not contain any stream') ||
        msg.includes('Could not find codec parameters')

      if (isResourceError && attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000 // Exponential backoff: 2s, 4s, 8s
        console.log(`  ⚠️  Resource error on attempt ${attempt}/${maxRetries} at ${timestampSeconds}s, retrying in ${delayMs}ms: ${shortMsg}`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      } else if (isNonTransient) {
        console.error(`  ❌ Non-transient ffmpeg error at ${timestampSeconds}s (skipping retries): ${shortMsg}`)
        break
      } else if (attempt < maxRetries) {
        console.log(`  ⚠️  Error on attempt ${attempt}/${maxRetries} at ${timestampSeconds}s, retrying: ${shortMsg}`)
        await new Promise(resolve => setTimeout(resolve, 1000)) // 1s delay for other errors
      } else {
        console.error(`  ❌ All ${maxRetries} attempts failed for frame at ${timestampSeconds}s: ${shortMsg}`)
      }
    }
  }

  // All retries exhausted (or we broke out on a non-transient error)
  const finalMsg: string = lastError?.stderr?.toString?.().trim() || lastError?.message || 'unknown error'
  throw new Error(`Failed to extract frame at ${timestampSeconds}s: ${finalMsg}`)
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
