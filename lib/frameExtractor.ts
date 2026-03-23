import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'

const execAsync = promisify(exec)

export interface FrameExtractionOptions {
  videoPath: string
  timestampSeconds: number
  outputDir?: string
}

/**
 * Extracts a frame from a video at a specific timestamp using ffmpeg
 * Requires ffmpeg to be installed on the system
 * Install: sudo apt-get install ffmpeg (Ubuntu/Debian) or brew install ffmpeg (macOS)
 */
export async function extractFrame(options: FrameExtractionOptions): Promise<string> {
  const { videoPath, timestampSeconds, outputDir } = options

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  // Create output directory
  const frameDir = outputDir || path.join(process.cwd(), 'public', 'temp', 'frames')
  if (!fs.existsSync(frameDir)) {
    fs.mkdirSync(frameDir, { recursive: true })
  }

  // Generate unique filename
  const videoBasename = path.basename(videoPath, path.extname(videoPath))
  const framePath = path.join(frameDir, `${videoBasename}_${timestampSeconds}s.jpg`)

  // Check if frame already exists
  if (fs.existsSync(framePath)) {
    console.log('Frame already extracted, using cached version')
    return framePath
  }

  try {
    // Extract frame using ffmpeg
    // -ss: seek to timestamp
    // -i: input file
    // -vframes 1: extract one frame
    // -q:v 2: high quality (1-31, lower is better)
    const command = `ffmpeg -ss ${timestampSeconds} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`
    
    console.log(`Extracting frame at ${timestampSeconds}s from ${videoPath}`)
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 5, // 5MB buffer
    })

    if (stderr && !stderr.includes('frame=')) {
      console.error('FFmpeg stderr:', stderr)
    }

    if (!fs.existsSync(framePath)) {
      throw new Error('Frame file was not created')
    }

    console.log(`Frame extracted successfully: ${framePath}`)
    return framePath
  } catch (error: any) {
    console.error('Error extracting frame:', error)
    throw new Error(`Failed to extract frame at ${timestampSeconds}s: ${error.message}`)
  }
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
  const dir = frameDir || path.join(process.cwd(), 'public', 'temp', 'frames')
  
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
