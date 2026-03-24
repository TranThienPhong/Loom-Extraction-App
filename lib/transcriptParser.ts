import { timestampToSeconds, secondsToTimestamp } from './frameExtractor'
import * as fs from 'fs'

export interface TranscriptEntry {
  timestamp_seconds: number
  timestamp_label: string
  text: string
}

/**
 * Parses a manually pasted transcript with timestamps
 * Handles multiple formats:
 * - "0:05 - First issue I noticed..."
 * - "1:23 First issue I noticed..."
 * - "0:05: First issue I noticed..."
 * - "[0:05] First issue I noticed..."
 * - Plain text without timestamps (assigns sequential timestamps every 10 seconds)
 */
export function parseManualTranscript(transcript: string): TranscriptEntry[] {
  const lines = transcript.split('\n').filter(line => line.trim())
  const entries: TranscriptEntry[] = []
  let autoTimestamp = 0

  for (const line of lines) {
    // Try multiple timestamp patterns
    const patterns = [
      /^(\d+:\d+)\s*[-:\s]+(.+)$/,           // 0:05 - text or 0:05: text
      /^\[(\d+:\d+)\]\s*(.+)$/,              // [0:05] text
      /^(\d+:\d+)\s+(.+)$/,                  // 0:05 text
      /^At\s+(\d+:\d+)\s*[-:\s]*(.+)$/i,    // At 0:05 - text
    ]
    
    let matched = false
    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (match) {
        const timestamp = match[1]
        const text = match[2].trim()
        
        try {
          const seconds = timestampToSeconds(timestamp)
          entries.push({
            timestamp_seconds: seconds,
            timestamp_label: secondsToTimestamp(seconds),
            text,
          })
          matched = true
          break
        } catch (error) {
          console.warn(`Invalid timestamp format: ${timestamp}`)
        }
      }
    }
    
    // If no timestamp found, treat as plain text and assign auto-timestamp
    if (!matched && line.trim()) {
      entries.push({
        timestamp_seconds: autoTimestamp,
        timestamp_label: secondsToTimestamp(autoTimestamp),
        text: line.trim(),
      })
      autoTimestamp += 10 // Increment by 10 seconds for next line
    }
  }

  return entries
}

/**
 * Parses SRT subtitle format
 * Format:
 * 1
 * 00:00:05,000 --> 00:00:10,000
 * First subtitle text
 * 
 * 2
 * 00:00:10,000 --> 00:00:15,000
 * Second subtitle text
 */
export function parseSRTTranscript(srtContent: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  const blocks = srtContent.split(/\n\s*\n/).filter(block => block.trim())

  for (const block of blocks) {
    const lines = block.split('\n')
    if (lines.length < 3) continue

    // Parse timestamp line (line 1, index 0 is the number)
    const timestampLine = lines[1]
    const timestampMatch = timestampLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/)
    
    if (timestampMatch) {
      const hours = parseInt(timestampMatch[1], 10)
      const minutes = parseInt(timestampMatch[2], 10)
      const seconds = parseInt(timestampMatch[3], 10)
      
      const totalSeconds = hours * 3600 + minutes * 60 + seconds
      const text = lines.slice(2).join(' ').trim()
      
      entries.push({
        timestamp_seconds: totalSeconds,
        timestamp_label: secondsToTimestamp(totalSeconds),
        text,
      })
    }
  }

  return entries
}

/**
 * Extracts video ID from Loom URL
 */
export function extractLoomVideoId(url: string): string | null {
  const match = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/)
  return match ? match[1] : null
}

/**
 * Parses Loom's JSON subtitle format downloaded via yt-dlp
 * The JSON contains a "phrases" array with timestamp and text
 */
export function parseJsonSubtitles(subtitlePath: string): TranscriptEntry[] {
  try {
    const fileContent = fs.readFileSync(subtitlePath, 'utf-8')
    const data = JSON.parse(fileContent)
    
    if (!data.phrases || !Array.isArray(data.phrases)) {
      throw new Error('Invalid subtitle format: missing phrases array')
    }

    const entries: TranscriptEntry[] = []

    for (const phrase of data.phrases) {
      if (phrase.ts !== undefined && phrase.value) {
        const seconds = Math.floor(phrase.ts) // ts is already in seconds
        entries.push({
          timestamp_seconds: seconds,
          timestamp_label: secondsToTimestamp(seconds),
          text: phrase.value.trim(),
        })
      }
    }

    return entries
  } catch (error) {
    console.error('Error parsing JSON subtitles:', error)
    throw new Error(`Failed to parse JSON subtitles: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Generates Loom URL with timestamp
 */
export function generateLoomUrlWithTimestamp(videoId: string, timestampSeconds: number): string {
  return `https://www.loom.com/share/${videoId}?t=${timestampSeconds}`
}
