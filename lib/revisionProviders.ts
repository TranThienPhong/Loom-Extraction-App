import Anthropic from '@anthropic-ai/sdk'
import { TranscriptEntry } from './aiProviders'

export interface RevisionScreenshot {
  timestamp_seconds: number
  timestamp_label: string
  image_url: string
  image_base64?: string
}

export interface GlobalNote {
  id: string
  note: string
  completed: boolean
}

export interface RevisionNote {
  id: string
  note_type: 'timestamped'
  timestamp_seconds: number
  timestamp_label: string
  referenced_timestamp_seconds?: number | null
  referenced_timestamp_label?: string | null
  note: string
  raw_speech?: string
  completed: boolean
  loom_url?: string
  screenshot_timestamps?: number[]
  screenshots?: RevisionScreenshot[]
}

export interface RevisionAnalysisResult {
  summary: string
  title: string
  global_notes: GlobalNote[]
  revision_notes: RevisionNote[]
}

const MAX_RETRIES = 4
const RETRY_DELAYS = [5000, 10000, 20000, 30000]

export async function analyzeTranscriptForRevision(
  transcript: TranscriptEntry[],
  dbContext = ''
): Promise<RevisionAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const anthropic = new Anthropic({ apiKey })
  const transcriptText = transcript
    .map(e => `[${e.timestamp_label}] ${e.text}`)
    .join('\n')

  const prompt = buildRevisionPrompt(transcriptText, dbContext)

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Revision AI analysis attempt ${attempt}/${MAX_RETRIES}...`)
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16384,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      return parseRevisionResponse(text)
    } catch (error: any) {
      const isOverloaded =
        error.status === 529 ||
        (typeof error.message === 'string' && error.message.includes('overloaded'))
      const isRateLimit =
        error.status === 429 ||
        (typeof error.message === 'string' && error.message.includes('rate_limit'))
      if ((isOverloaded || isRateLimit) && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt - 1]
        console.warn(`Claude overloaded (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay / 1000}s...`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw new Error(`Revision AI failed: ${error.message}`)
    }
  }
  throw new Error('Revision AI analysis failed after all retries')
}

function buildRevisionPrompt(transcriptText: string, dbContext = ''): string {
  return `You are analyzing a video review session where someone is watching a video (promo, animation, documentary, explainer, etc.) and speaking revision notes aloud.

Your task: Extract EVERY revision note, correction, or feedback point mentioned. Categorize each as either GLOBAL (applies to the whole video) or TIMESTAMPED (specific moment).
${dbContext ? '\n' + dbContext + '\n' : ''}
Here is the transcript with timestamps:

${transcriptText}

Instructions:

1. **Title**: Generate a concise revision session title, e.g. "Revision Notes for Section 1 of Financial Reckoning Day"

2. **Summary**: Write 2-3 sentences describing what the video is about and the nature of the revisions needed.

3. **Global Notes**: Recurring rules or patterns that apply to the entire video.
   Examples:
   - "Whenever the brand logo appears, ensure it is on a white background"
   - "The main title font must always be bold and left-aligned"
   - "All graph lines should use the brand color palette"

4. **Timestamped Revision Notes**: Specific fixes tied to exact moments in the video.
   - "timestamp_seconds" / "timestamp_label": When the reviewer SPOKE these words in the Loom recording (e.g., 4:46).
   - "referenced_timestamp_seconds" / "referenced_timestamp_label": The timestamp in the VIDEO BEING REVIEWED that needs to be fixed (e.g., if the reviewer says "fix it at the 9:48 mark", this would be 9:48). Extract this from the reviewer's speech. Set to null if no specific timestamp is referenced.
   
5. **AI Cleanup — CRITICAL**: Convert rough, unclear speech into precise, professional editor instructions.
   Before/After examples:
   - "this line should be green" → "Change the animated red descending graph line to green"
   - "uh remove this thing" → "Remove the overlay text element from the lower third"
   - "move this hand to the 4" → "Animate the clock hand to point to the 4 o'clock position"
   - "the face looks weird" → "The presenter's face appears distorted during the transition — correct the morph/blend"
   - "too fast" → "Slow down the transition between the chart slides for better readability"
   - "this doesn't match" → "The background color does not match the brand palette — align with the reference"

6. **Screenshot Timestamps**: For each timestamped note, include 1-3 nearby timestamps for frame capture. Pick the best moments to visually capture the issue.

Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):
{
  "title": "<revision session title>",
  "summary": "<2-3 sentence summary of the video and revisions>",
  "global_notes": [
    {
      "note": "<clear editor instruction applying to whole video>"
    }
  ],
  "revision_notes": [
    {
      "timestamp_seconds": <when reviewer spoke this in the Loom - integer>,
      "timestamp_label": "<M:SS - when reviewer spoke this>",
      "referenced_timestamp_seconds": <timestamp in the video being reviewed that needs fixing, or null>,
      "referenced_timestamp_label": "<M:SS of the fix location in the reviewed video, or null>",
      "note": "<clean, professional editor instruction>",
      "raw_speech": "<verbatim original speech from transcript>",
      "screenshot_timestamps": [<1-3 timestamp numbers as integers>]
    }
  ]
}

Rules:
- Each distinct feedback point is its own revision note
- Keep notes concise but specific (what to change, where it is, how to fix it)
- If a rule applies globally, put it in global_notes — not in revision_notes
- If it targets a specific timestamp, put it in revision_notes
- Return empty arrays if no notes found of that type
- Do NOT number the notes`
}

function parseRevisionResponse(text: string): RevisionAnalysisResult {
  // Strip markdown code fences
  let cleaned = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  // Find JSON object bounds
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.substring(start, end + 1)
  }

  try {
    const parsed = JSON.parse(cleaned)

    const globalNotes: GlobalNote[] = (parsed.global_notes || []).map(
      (n: any, i: number) => ({
        id: `g-${i}`,
        note: n.note || '',
        completed: false,
      })
    )

    const revisionNotes: RevisionNote[] = (parsed.revision_notes || []).map(
      (n: any, i: number) => ({
        id: `r-${i}`,
        note_type: 'timestamped' as const,
        timestamp_seconds: typeof n.timestamp_seconds === 'number' ? n.timestamp_seconds : 0,
        timestamp_label: n.timestamp_label || '0:00',
        referenced_timestamp_seconds: typeof n.referenced_timestamp_seconds === 'number' ? n.referenced_timestamp_seconds : null,
        referenced_timestamp_label: n.referenced_timestamp_label || null,
        note: n.note || '',
        raw_speech: n.raw_speech || '',
        completed: false,
        screenshot_timestamps: Array.isArray(n.screenshot_timestamps)
          ? n.screenshot_timestamps
          : [n.timestamp_seconds || 0],
      })
    )

    return {
      title: parsed.title || 'Revision Notes',
      summary: parsed.summary || '',
      global_notes: globalNotes,
      revision_notes: revisionNotes,
    }
  } catch (err) {
    console.error('Failed to parse revision AI response:', err)
    console.error('Response preview:', text.substring(0, 500))
    throw new Error('AI returned invalid JSON for revision analysis')
  }
}
