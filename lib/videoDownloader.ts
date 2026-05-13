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
 * Check if yt-dlp is installed
 */
async function checkYtDlpInstalled(): Promise<boolean> {
  try {
    await execAsync('which yt-dlp')
    return true
  } catch {
    return false
  }
}

/**
 * Downloads a Loom video using yt-dlp
 * Requires yt-dlp to be installed on the system
 * Install: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
 */
export async function downloadLoomVideo(loomUrl: string): Promise<VideoDownloadResult> {
  // Check if yt-dlp is installed
  const ytDlpInstalled = await checkYtDlpInstalled()
  if (!ytDlpInstalled) {
    throw new Error(
      'yt-dlp is not installed. Please install it first:\n\n' +
      'Linux/Mac: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp\n\n' +
      'Or run: ./check-dependencies.sh for more information.'
    )
  }

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
    // Format priority:
    //   1. Direct HTTPS combined stream (fastest — no HLS segment overhead, e.g. Loom http-transcoded)
    //   2. HLS video+audio merge at ≤720p
    //   3. Any best format at ≤1080p
    //   4. Absolute fallback
    console.log(`Downloading video: ${loomUrl}`)
    const command = [
      'yt-dlp',
      '--no-playlist',
      '-f "best[protocol=https][height<=1080]/bestvideo[height<=720]+bestaudio/best[height<=1080]/best"',
      '--merge-output-format mp4',
      `--output "${outputPath}"`,
      `"${loomUrl}"`,
    ].join(' ')
    
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      timeout: 600000, // 10 minute timeout
    })

    console.log('Download stdout:', stdout)
    if (stderr) console.log('Download stderr:', stderr)

    // yt-dlp sometimes outputs as .mp4 even if the template says otherwise; scan for the file
    if (!fs.existsSync(outputPath)) {
      // Look for any video file that yt-dlp may have named slightly differently
      const tempDir = path.dirname(outputPath)
      const altFiles = fs.readdirSync(tempDir).filter(f =>
        f.startsWith(path.basename(outputPath, '.mp4')) && /\.(mp4|mkv|webm)$/.test(f)
      )
      if (altFiles.length > 0) {
        const altPath = path.join(tempDir, altFiles[0])
        console.log(`Video saved as alternate name, renaming: ${altPath} → ${outputPath}`)
        fs.renameSync(altPath, outputPath)
      } else {
        throw new Error('Video file was not created')
      }
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

/**
 * Downloads subtitles for a Loom video using yt-dlp
 * Returns the path to the subtitle file and its format ('json' | 'vtt')
 */
export async function downloadLoomSubtitles(loomUrl: string): Promise<{ path: string; format: 'json' | 'vtt' }> {
  // Check if yt-dlp is installed
  const ytDlpInstalled = await checkYtDlpInstalled()
  if (!ytDlpInstalled) {
    throw new Error(
      'yt-dlp is not installed. Please install it first:\n\n' +
      'Linux/Mac: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp\n\n' +
      'Or run: ./check-dependencies.sh for more information.'
    )
  }

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

  const jsonPath = path.join(tempDir, `${videoId}.en.json`)
  const vttPath  = path.join(tempDir, `${videoId}.en.vtt`)

  // Return cached files if they exist
  if (fs.existsSync(jsonPath)) {
    console.log('Subtitles (JSON) already downloaded, using cached version')
    return { path: jsonPath, format: 'json' }
  }
  if (fs.existsSync(vttPath)) {
    console.log('Subtitles (VTT) already downloaded, using cached version')
    return { path: vttPath, format: 'vtt' }
  }

  const baseOutput = path.join(tempDir, videoId)

  // Attempt 1: JSON format (Loom native)
  try {
    console.log(`Downloading subtitles (JSON): ${loomUrl}`)
    const cmd = `yt-dlp --write-subs --sub-format json --skip-download -o "${baseOutput}" "${loomUrl}"`
    const { stderr } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10, timeout: 60000 })
    if (stderr) console.warn('Subtitle JSON stderr:', stderr)
    if (fs.existsSync(jsonPath)) {
      console.log('Subtitles downloaded as JSON')
      return { path: jsonPath, format: 'json' }
    }
    // yt-dlp may write without language suffix — check alternate name
    const altJson = path.join(tempDir, `${videoId}.json`)
    if (fs.existsSync(altJson)) {
      fs.renameSync(altJson, jsonPath)
      return { path: jsonPath, format: 'json' }
    }
  } catch (err: any) {
    console.warn('JSON subtitle download failed, trying VTT:', err.message)
  }

  // Attempt 2: VTT format (auto-subs fallback)
  try {
    console.log(`Downloading subtitles (VTT): ${loomUrl}`)
    const cmd = `yt-dlp --write-subs --write-auto-subs --sub-langs en --sub-format vtt --skip-download -o "${baseOutput}" "${loomUrl}"`
    const { stderr } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10, timeout: 60000 })
    if (stderr) console.warn('Subtitle VTT stderr:', stderr)
    if (fs.existsSync(vttPath)) {
      console.log('Subtitles downloaded as VTT')
      return { path: vttPath, format: 'vtt' }
    }
    // Scan for any .vtt file created by yt-dlp
    const anyVtt = fs.readdirSync(tempDir).find(f => f.startsWith(videoId) && f.endsWith('.vtt'))
    if (anyVtt) {
      const found = path.join(tempDir, anyVtt)
      fs.renameSync(found, vttPath)
      return { path: vttPath, format: 'vtt' }
    }
  } catch (err: any) {
    console.warn('VTT subtitle download also failed:', err.message)
  }

  throw new Error('Could not download subtitles in any supported format (json, vtt). The video may not have captions.')
}
