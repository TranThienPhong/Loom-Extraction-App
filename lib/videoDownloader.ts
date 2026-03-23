import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'

const execAsync = promisify(exec)

export interface VideoDownloadResult {
  videoPath: string
  videoId: string
}

/**
 * Downloads a Loom video using yt-dlp
 * Requires yt-dlp to be installed on the system
 * Install: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
 */
export async function downloadLoomVideo(loomUrl: string): Promise<VideoDownloadResult> {
  // Extract video ID from URL
  const videoIdMatch = loomUrl.match(/loom\.com\/share\/([a-zA-Z0-9]+)/)
  if (!videoIdMatch) {
    throw new Error('Invalid Loom URL format')
  }
  const videoId = videoIdMatch[1]

  // Create temp directory if it doesn't exist
  // @ts-ignore - turbopack ignore: dynamic path only used at runtime
  const tempDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'temp')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const outputPath = path.join(tempDir, `${videoId}.mp4`)

  // Check if video already exists
  if (fs.existsSync(outputPath)) {
    console.log('Video already downloaded, using cached version')
    return { videoPath: outputPath, videoId }
  }

  try {
    // Download video using yt-dlp
    console.log(`Downloading video: ${loomUrl}`)
    const command = `yt-dlp -f "best[ext=mp4]" -o "${outputPath}" "${loomUrl}"`
    
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
    })

    console.log('Download stdout:', stdout)
    if (stderr) console.error('Download stderr:', stderr)

    if (!fs.existsSync(outputPath)) {
      throw new Error('Video file was not created')
    }

    console.log(`Video downloaded successfully to: ${outputPath}`)
    return { videoPath: outputPath, videoId }
  } catch (error: any) {
    console.error('Error downloading video:', error)
    throw new Error(`Failed to download video: ${error.message}`)
  }
}

/**
 * Clean up downloaded video file
 */
export function cleanupVideo(videoPath: string): void {
  try {
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath)
      console.log(`Cleaned up video: ${videoPath}`)
    }
  } catch (error) {
    console.error('Error cleaning up video:', error)
  }
}
