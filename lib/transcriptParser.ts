import { timestampToSeconds, secondsToTimestamp } from './frameExtractor'

export interface TranscriptEntry {
  timestamp_seconds: number
  timestamp_label: string
  text: string
}

/**
 * Parses a manually pasted transcript with timestamps
 * Expected formats:
 * - "0:05 - First issue I noticed..."
 * - "1:23 First issue I noticed..."
 * - "0:05 First issue I noticed..."
 */
export function parseManualTranscript(transcript: string): TranscriptEntry[] {
  const lines = transcript.split('\n').filter(line => line.trim())
  const entries: TranscriptEntry[] = []

  for (const line of lines) {
    // Try to match timestamp patterns
    const match = line.match(/^(\d+:\d+)\s*[-:\s]*(.+)$/)
    
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
      } catch (error) {
        console.warn(`Skipping line with invalid timestamp: ${line}`)
      }
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
 * Generates Loom URL with timestamp
 */
export function generateLoomUrlWithTimestamp(videoId: string, timestampSeconds: number): string {
  return `https://www.loom.com/share/${videoId}?t=${timestampSeconds}`
}
