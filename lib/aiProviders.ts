import Anthropic from '@anthropic-ai/sdk'

export interface AIAnalysisResult {
  timestamp_seconds: number
  timestamp_label: string
  task_name: string
  task_description: string
  screenshot_timestamps?: number[]
  priority?: number
  complexity?: string
  project?: string
  client?: string
  area?: string
  assignee?: string
  task_type?: string
  // 1-based index identifying which submitted Loom video this task came from.
  // Only meaningful when the extraction spans multiple videos; defaults to 1.
  video_index?: number
}

export interface TranscriptEntry {
  timestamp_seconds: number
  timestamp_label: string
  text: string
  // 1-based: which Loom video this transcript line came from. Absent/1 for
  // single-video runs, so the existing code path stays unchanged.
  video_index?: number
}

/**
 * Highest 1-based video index referenced by the transcript. 1 for single-video runs.
 */
function videoCountOf(entries: TranscriptEntry[]): number {
  let max = 1
  for (const e of entries) {
    const vi = e.video_index || 1
    if (vi > max) max = vi
  }
  return max
}

/**
 * Render the transcript as the AI sees it. For multi-video runs, emit a
 * `=== VIDEO N ===` header each time the video_index changes so the AI can
 * attribute tasks to the right source video.
 */
function renderTranscriptForAI(entries: TranscriptEntry[]): string {
  const videoCount = videoCountOf(entries)
  if (videoCount <= 1) {
    return entries.map(e => `[${e.timestamp_label}] ${e.text}`).join('\n')
  }
  const lines: string[] = []
  let lastVideo = -1
  for (const e of entries) {
    const vi = e.video_index || 1
    if (vi !== lastVideo) {
      lines.push(`\n=== VIDEO ${vi} ===`)
      lastVideo = vi
    }
    lines.push(`[${e.timestamp_label}] ${e.text}`)
  }
  return lines.join('\n')
}

/**
 * Multi-provider AI analyzer
 * Supports: Anthropic Claude, OpenAI GPT-4, OpenRouter (free), and Ollama (local)
 */

// Anthropic Claude provider — tries Sonnet first, falls back to Haiku on overload.
// Haiku is far less likely to be overloaded, so it's a much better fallback than
// running 4 long retries against a Sonnet model that's currently saturated.
export async function analyzeWithClaude(transcript: TranscriptEntry[], dbContext = ''): Promise<AIAnalysisResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }

  const anthropic = new Anthropic({ apiKey })

  const transcriptText = renderTranscriptForAI(transcript)
  const prompt = buildAnalysisPrompt(transcriptText, dbContext, videoCountOf(transcript))

  // Models to try, in order. After Sonnet's short retry budget is exhausted on
  // an overload, fall through to Haiku rather than burning more time on Sonnet.
  const MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5']
  // Base delays + jitter prevents thundering-herd when user resubmits during a wait.
  const RETRIES_PER_MODEL = 2
  const BASE_DELAY_MS = [4000, 8000]

  let lastError: any = null

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= RETRIES_PER_MODEL; attempt++) {
      try {
        console.log(`Using Anthropic Claude (${model}) for AI analysis... (attempt ${attempt}/${RETRIES_PER_MODEL})`)

        const message = await anthropic.messages.create({
          model,
          max_tokens: 16384,
          messages: [{ role: 'user', content: prompt }],
        })

        const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
        return parseAIResponse(responseText)
      } catch (error: any) {
        lastError = error
        const isOverloaded = error.status === 529 || (typeof error.message === 'string' && error.message.includes('overloaded'))
        const isRateLimit = error.status === 429 || (typeof error.message === 'string' && error.message.includes('rate_limit'))
        const retriable = isOverloaded || isRateLimit

        if (!retriable) {
          console.error('Claude API error (non-retriable):', error.message)
          throw new Error(`Claude API failed: ${error.message}`)
        }

        if (attempt < RETRIES_PER_MODEL) {
          const jitter = Math.floor(Math.random() * 1500)
          const delay = BASE_DELAY_MS[attempt - 1] + jitter
          console.warn(`Claude ${model} overloaded/rate-limited (attempt ${attempt}/${RETRIES_PER_MODEL}), retrying in ${Math.round(delay / 1000)}s...`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }

        // Exhausted retries on this model — break to fall over to next model.
        console.warn(`Claude ${model} exhausted after ${RETRIES_PER_MODEL} attempts, falling over to next model...`)
        break
      }
    }
  }

  console.error('Claude API error after all models:', lastError?.message)
  throw new Error(`Claude API failed (all models overloaded): ${lastError?.message || 'unknown'}`)
}

// OpenAI GPT-4 provider
export async function analyzeWithOpenAI(transcript: TranscriptEntry[], dbContext = ''): Promise<AIAnalysisResult[]> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const transcriptText = renderTranscriptForAI(transcript)
  const prompt = buildAnalysisPrompt(transcriptText, dbContext, videoCountOf(transcript))

  try {
    console.log('Using OpenAI GPT-4 for AI analysis...')
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    const responseText = data.choices[0].message.content
    return parseAIResponse(responseText)
  } catch (error: any) {
    console.error('OpenAI API error:', error.message)
    throw new Error(`OpenAI API failed: ${error.message}`)
  }
}

// OpenRouter provider (supports many free models)
export async function analyzeWithOpenRouter(transcript: TranscriptEntry[], dbContext = ''): Promise<AIAnalysisResult[]> {
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set. Get free key at: https://openrouter.ai/keys')
  }

  const transcriptText = renderTranscriptForAI(transcript)
  const prompt = buildAnalysisPrompt(transcriptText, dbContext, videoCountOf(transcript))

  try {
    console.log('Using OpenRouter for AI analysis...')
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Loom Task Extractor',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.1-8b-instruct:free', // Free model
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`OpenRouter API error: ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    const responseText = data.choices[0].message.content
    return parseAIResponse(responseText)
  } catch (error: any) {
    console.error('OpenRouter API error:', error.message)
    throw new Error(`OpenRouter API failed: ${error.message}`)
  }
}

// Ollama local provider (free, runs locally)
export async function analyzeWithOllama(transcript: TranscriptEntry[], dbContext = ''): Promise<AIAnalysisResult[]> {
  const model = process.env.OLLAMA_MODEL || 'llama3.1'
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

  const transcriptText = renderTranscriptForAI(transcript)
  const prompt = buildAnalysisPrompt(transcriptText, dbContext, videoCountOf(transcript))

  try {
    console.log(`Using Ollama (${model}) for AI analysis...`)
    
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 4096,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`)
    }

    const data = await response.json()
    return parseAIResponse(data.response)
  } catch (error: any) {
    console.error('Ollama API error:', error.message)
    throw new Error(`Ollama API failed: ${error.message}. Make sure Ollama is running: ollama serve`)
  }
}

// Build the analysis prompt
function buildAnalysisPrompt(transcriptText: string, dbContext = '', videoCount = 1): string {
  const multi = videoCount > 1
  const multiVideoNote = multi
    ? `\n**MULTIPLE VIDEOS**: The transcript below combines ${videoCount} separate Loom videos. Each video's section starts with a "=== VIDEO N ===" header. Each task you return MUST include a "video_index" field (a number from 1 to ${videoCount}) identifying which source video the task came from. Timestamps reset to 0:00 at the start of each video — never combine timestamps across videos.\n`
    : ''
  const videoIndexField = multi ? `\n  "video_index": <integer 1-${videoCount} indicating source video>,` : ''
  const videoIndexExample = multi ? `\n    "video_index": 1,` : ''
  return `You are analyzing a video transcript where someone is providing feedback, requesting changes, or identifying issues that need to be fixed.

Your task: Extract EVERY moment where a task, fix, change, or improvement is mentioned or requested.
${dbContext ? '\n' + dbContext + '\n' : ''}${multiVideoNote}
Here is the transcript with timestamps:

${transcriptText}

Instructions:
1. Identify each distinct task, fix, or change request
2. For each one, determine the PRIMARY timestamp when it was first mentioned
3. **CRITICAL**: Identify 1-3 key screenshot moments that capture the visual context:
   - Before state (if an action is about to happen)
   - During action (mouse click, hover, interaction moment)
   - After state (result of action, popup, error shown)
   - For simple issues, 1 screenshot at the mention time is enough
   - For complex interactions, capture 2-3 moments (before/during/after)
4. Create a clear, actionable task name (5-10 words). Do NOT start it with a number or ordinal prefix.
5. Write a CONCISE task description (2-3 sentences max, ~50 words) with key context only
6. For project, client, area, and assignee:
   - First try to extract them from the transcript
   - If the transcript does NOT mention a value, pick the BEST matching option from the Reference Database above (if provided)
   - Leave empty ONLY if there is truly no reasonable match in either the transcript or the database
   - **ASSIGNEE — CRITICAL**: The transcript is auto-transcribed so names are frequently garbled. Always fuzzy-match spoken names to the closest entry in USERS by phonetic similarity or spelling. Examples: "Jonas" / "Jaunas" / "Yaunius" → Jaunius | "Foam" / "Phone" / "Fong" / "Pong" → Phong. Never leave the raw mispelled transcript name — always resolve to a real USERS entry if one is a plausible match.
7. Priority: 1.1-4.9 scale (1.x=GAME OVER, 2.x=MAJOR LOSS, 3.x=MAJOR GAIN, 4.x=NICE-TO-HAVE). Always use 3.0 — do not leave blank or omit, even if priority is never mentioned.
8. Complexity: one of "SupC" (Super Complex), "COMP" (Complex), "MOD" (Moderate), "SIMP" (Simple)
9. Task Type: "Need-to-have" if the speaker explicitly marks it as urgent, must-do today, blocking, or critical. "Nice-to-have" for everything else — including tasks that are not mentioned as urgent, low-priority suggestions, or improvements with no stated deadline.

**CRITICAL**: Keep descriptions SHORT - Railway has limited resources. Focus on: what needs fixing, where it is, and why.

Return ONLY a JSON array with no additional text, explanation, or markdown formatting. Each object must have exactly these fields:
{
  "timestamp_seconds": <number>,
  "timestamp_label": "<M:SS format>",
  "task_name": "<short descriptive title — no leading numbers>",
  "task_description": "<concise description>",
  "screenshot_timestamps": [<array of 1-3 timestamp numbers in seconds>],
  "priority": <number e.g. 3.0>,
  "complexity": "<SupC|COMP|MOD|SIMP>",
  "project": "<project name from transcript or database>",
  "client": "<client name from transcript or database>",
  "area": "<area/job role from transcript or database>",
  "assignee": "<assignee name from transcript or database>",
  "task_type": "<Need-to-have|Nice-to-have>"${videoIndexField}
}

Example:
[
  {
    "timestamp_seconds": 44,
    "timestamp_label": "0:44",
    "task_name": "Fix header alignment on mobile",
    "task_description": "Header navigation shifted left ~10px on mobile. Visible on home page iPhone view.",
    "screenshot_timestamps": [44, 46],
    "priority": 3.0,
    "complexity": "SIMP",
    "project": "Taskr App",
    "client": "LaunchMen",
    "area": "Graphic Design",
    "assignee": "Phong Tran",
    "task_type": "Nice-to-have"${videoIndexExample}
  }
]

**IMPORTANT**: Keep ALL descriptions under 50 words.

Return the JSON array now:`
}

// Parse AI response to extract JSON
function parseAIResponse(responseText: string): AIAnalysisResult[] {
  console.log('AI response:', responseText.substring(0, 500) + '...')

  // Remove markdown code fences
  const cleanedResponse = responseText
    .replace(/```json\n/g, '')
    .replace(/```\n/g, '')
    .replace(/```/g, '')
    .trim()

  try {
    const tasks = JSON.parse(cleanedResponse)
    
    if (!Array.isArray(tasks)) {
      throw new Error('Response is not an array')
    }

    // Validate structure
    for (const task of tasks) {
      if (
        typeof task.timestamp_seconds !== 'number' ||
        typeof task.timestamp_label !== 'string' ||
        typeof task.task_name !== 'string' ||
        typeof task.task_description !== 'string'
      ) {
        throw new Error('Invalid task structure')
      }
    }

    console.log(`Successfully parsed ${tasks.length} tasks`)
    
    // Log screenshot_timestamps presence for debugging
    tasks.forEach((task, i) => {
      const hasScreenshots = task.screenshot_timestamps && task.screenshot_timestamps.length > 0
      console.log(`Task ${i + 1}: ${task.task_name} | screenshot_timestamps: ${hasScreenshots ? task.screenshot_timestamps?.length + ' frames' : 'MISSING'}`)
    })
    
    return tasks
  } catch (error) {
    console.error('Failed to parse AI response:', error)
    throw new Error('AI returned invalid JSON format. Please try again.')
  }
}

/**
 * PDF-extracted block fed to the AI for task synthesis.
 * The `index` is the AI's handle back to the source block — used downstream
 * to re-attach the right images and Loom URLs to each returned task.
 */
export interface PdfBlockForAI {
  index: number
  page: number
  firstLine: string
  text: string
  hasImages: boolean
  hasLoomUrls: boolean
}

/**
 * Like AIAnalysisResult but with a `source_block_index` so the caller can
 * re-attach images/URLs from the originating PDF block. Block-derived tasks
 * don't have video timestamps — those fields are zero/empty.
 */
export interface PdfAIAnalysisResult extends Omit<AIAnalysisResult, 'video_index'> {
  source_block_index: number
}

function buildPdfAnalysisPrompt(blocks: PdfBlockForAI[], dbContext = ''): string {
  const blocksText = blocks
    .map(b => `Block #${b.index} (page ${b.page})${b.hasImages ? ' [has image]' : ''}${b.hasLoomUrls ? ' [has loom link]' : ''}:\n${b.text}`)
    .join('\n\n---\n\n')

  return `You are analyzing extracted blocks from a PDF document where someone has written feedback, change requests, or bug reports for a software product. Each block was extracted in reading order from the PDF.

Your task: Identify EVERY block that describes a task, fix, change, or bug, and convert it into a structured task entry. Skip blocks that are pure noise (document titles, page footers, screenshot captions without actionable content, single-word labels).
${dbContext ? '\n' + dbContext + '\n' : ''}
Here are the PDF blocks:

${blocksText}

Instructions:
1. Look for blocks that describe something to fix, build, change, or improve. Common patterns: "TEAM:", "TASKS:", "BUG:", "MY DAY:", "ADMIN PAGE:", "PROJECTS:", "GLOBAL:" — these section prefixes usually mark a task. But also accept tasks without prefixes if the block clearly describes work.
2. For each real task, create:
   - A clear, actionable task_name (5-10 words). Do NOT start it with a number, ordinal, or the section prefix.
   - A concise task_description (2-3 sentences, ~50 words) summarizing what needs doing.
3. If a section prefix like "TEAM:" or "BUG:" appears, use it as a hint for the area or task_type — e.g., "BUG:" implies a fix task; "GLOBAL:" implies app-wide scope.
4. For project, client, area, and assignee:
   - First try to extract them from the block text.
   - If not present in the text, pick the BEST matching option from the Reference Database above (if provided).
   - Leave empty ONLY if there is no reasonable match.
   - **ASSIGNEE — CRITICAL**: PDF text may have typos or abbreviated names. Fuzzy-match to the closest USERS entry (e.g. "Jonas"/"Yaunius"→Jaunius, "Phong"/"Fong"→Phong). Never leave the raw mispelled name.
5. Priority: 1.1-4.9 scale (1.x=GAME OVER, 2.x=MAJOR LOSS, 3.x=MAJOR GAIN, 4.x=NICE-TO-HAVE). Default to 3.0 if not signaled.
6. Complexity: one of "SupC", "COMP", "MOD", "SIMP".
7. Task Type: "Need-to-have" only if the block explicitly marks urgency/blocking/critical. Otherwise "Nice-to-have".
8. **source_block_index**: set to the Block # the task came from. This is REQUIRED — it's how we re-attach the right screenshots and Loom links.

If a single block contains MULTIPLE distinct tasks, return multiple task entries all sharing the same source_block_index.
Skip blocks that aren't real tasks — don't pad the list.

Return ONLY a JSON array with no additional text, explanation, or markdown formatting. Each object must have exactly these fields:
{
  "task_name": "<short descriptive title — no leading numbers or section prefix>",
  "task_description": "<concise description>",
  "priority": <number e.g. 3.0>,
  "complexity": "<SupC|COMP|MOD|SIMP>",
  "project": "<project name from text or database>",
  "client": "<client name from text or database>",
  "area": "<area/job role from text or database>",
  "assignee": "<assignee name from text or database>",
  "task_type": "<Need-to-have|Nice-to-have>",
  "source_block_index": <integer matching one of the Block # values above>
}

Example:
[
  {
    "task_name": "Build returned-tasks log on admin page",
    "task_description": "Add a section on the admin page that lists tasks returned by team members so admins/executives can identify managers with repeat returns.",
    "priority": 3.0,
    "complexity": "MOD",
    "project": "Loomster",
    "client": "Mars",
    "area": "Admin",
    "assignee": "Phong",
    "task_type": "Nice-to-have",
    "source_block_index": 8
  }
]

Return the JSON array now:`
}

/**
 * Multi-provider PDF block analyzer. Tries Anthropic first, falls back through
 * the same chain as the Loom flow.
 */
export async function analyzePdfBlocksWithAI(blocks: PdfBlockForAI[], dbContext = ''): Promise<PdfAIAnalysisResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set')

  const prompt = buildPdfAnalysisPrompt(blocks, dbContext)

  // Reuse the same Sonnet→Haiku fallback ladder as the Loom path.
  const MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5']
  const RETRIES_PER_MODEL = 2
  const BASE_DELAY_MS = [4000, 8000]

  const anthropic = new Anthropic({ apiKey })
  let lastError: any = null
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= RETRIES_PER_MODEL; attempt++) {
      try {
        console.log(`PDF analysis: Claude (${model}) attempt ${attempt}/${RETRIES_PER_MODEL}`)
        const message = await anthropic.messages.create({
          model,
          max_tokens: 16384,
          messages: [{ role: 'user', content: prompt }],
        })
        const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
        return parsePdfAIResponse(responseText)
      } catch (error: any) {
        lastError = error
        const isOverloaded = error.status === 529 || (typeof error.message === 'string' && error.message.includes('overloaded'))
        const isRateLimit = error.status === 429 || (typeof error.message === 'string' && error.message.includes('rate_limit'))
        const retriable = isOverloaded || isRateLimit
        if (!retriable) {
          console.error('PDF analysis Claude error (non-retriable):', error.message)
          throw new Error(`Claude API failed: ${error.message}`)
        }
        if (attempt < RETRIES_PER_MODEL) {
          const jitter = Math.floor(Math.random() * 1500)
          const delay = BASE_DELAY_MS[attempt - 1] + jitter
          console.warn(`PDF Claude ${model} overloaded, retrying in ${Math.round(delay / 1000)}s`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
        console.warn(`PDF Claude ${model} exhausted, falling over to next model`)
        break
      }
    }
  }
  throw new Error(`Claude API failed (all models overloaded): ${lastError?.message || 'unknown'}`)
}

function parsePdfAIResponse(responseText: string): PdfAIAnalysisResult[] {
  console.log('PDF AI response:', responseText.substring(0, 400) + '...')
  const cleaned = responseText
    .replace(/```json\n/g, '')
    .replace(/```\n/g, '')
    .replace(/```/g, '')
    .trim()
  try {
    const tasks = JSON.parse(cleaned)
    if (!Array.isArray(tasks)) throw new Error('PDF response is not an array')
    for (const t of tasks) {
      if (typeof t.task_name !== 'string' || typeof t.task_description !== 'string') {
        throw new Error('Invalid PDF task structure')
      }
      if (typeof t.source_block_index !== 'number') {
        throw new Error(`Task is missing required source_block_index: ${t.task_name}`)
      }
    }
    console.log(`PDF AI returned ${tasks.length} tasks`)
    return tasks
  } catch (err) {
    console.error('Failed to parse PDF AI response:', err)
    throw new Error('AI returned invalid JSON format for PDF analysis. Please try again.')
  }
}

/**
 * Generate a brief summary of a PDF based on the extracted block text.
 */
export async function generatePdfSummary(blocks: PdfBlockForAI[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return ''
  const anthropic = new Anthropic({ apiKey })

  // Cap to first ~40 blocks to keep the summary call cheap.
  const sample = blocks.slice(0, 40).map(b => `[Block ${b.index}] ${b.text}`).join('\n\n')

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Based on these blocks extracted from a feedback PDF, write a structured summary with exactly 3 paragraphs separated by a blank line between each:

Paragraph 1 (2-3 sentences): What is this document about — what product/feature/area is being discussed, and the overall nature of the feedback.

Paragraph 2 (1-2 sentences): Identify task urgency — which areas appear need-to-have (urgent, blocking, critical) versus nice-to-have (improvements, suggestions).

Paragraph 3 (1-2 sentences): Identify team assignment — based on the pages, features, or modules discussed, describe who the tasks appear to be assigned to.

Blocks:
${sample}

Write only the 3 paragraphs with a blank line between each. No headings, no labels, no preamble.`,
      }],
    })
    return message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  } catch (error) {
    console.error('PDF summary generation failed:', error)
    return ''
  }
}

/**
 * Generate a brief summary of the video based on the transcript
 */
export async function generateVideoSummary(transcript: TranscriptEntry[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return ''

  const anthropic = new Anthropic({ apiKey })

  // Use first 80 entries max (faster, cheaper for summary)
  const sampleEntries = transcript.slice(0, 80)
  const transcriptText = renderTranscriptForAI(sampleEntries)
  const videoCount = videoCountOf(transcript)
  const multiVideoNote = videoCount > 1
    ? `\n\nNote: This transcript combines ${videoCount} separate Loom videos, marked with "=== VIDEO N ===" headers. Treat them as one combined feedback session.`
    : ''

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Based on this video transcript, write a structured summary with exactly 3 paragraphs separated by a blank line between each:

Paragraph 1 (2-3 sentences): Describe what the video is about — who is speaking, what product/feature/area they are reviewing, and the overall nature of the feedback.

Paragraph 2 (1-2 sentences): Identify task urgency — summarize which tasks or areas appear to be need-to-have (urgent, blocking, critical) versus nice-to-have (improvements, suggestions, low priority).

Paragraph 3 (1-2 sentences): Identify team assignment — based on the pages, features, or modules discussed, describe who the tasks appear to be assigned to. Use names or roles mentioned in the transcript.${multiVideoNote}

Transcript:
${transcriptText}

Write only the 3 paragraphs with a blank line between each. No headings, no labels, no preamble.`
      }]
    })
    return message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  } catch (error) {
    console.error('Summary generation failed:', error)
    return ''
  }
}

/**
 * Main function: tries providers in order until one succeeds
 */
export async function analyzeTranscriptWithAI(transcript: TranscriptEntry[], dbContext = ''): Promise<AIAnalysisResult[]> {
  const providers = [
    { name: 'Anthropic Claude', fn: analyzeWithClaude, envCheck: () => !!process.env.ANTHROPIC_API_KEY },
    { name: 'OpenAI GPT-4', fn: analyzeWithOpenAI, envCheck: () => !!process.env.OPENAI_API_KEY },
    { name: 'OpenRouter (Free)', fn: analyzeWithOpenRouter, envCheck: () => !!process.env.OPENROUTER_API_KEY },
    // Ollama only runs when explicitly configured — otherwise the localhost fetch
    // always fails on Railway/serverless and just adds noise to the error trail.
    { name: 'Ollama (Local)', fn: analyzeWithOllama, envCheck: () => !!process.env.OLLAMA_BASE_URL },
  ]

  const availableProviders = providers.filter(p => p.envCheck())
  
  if (availableProviders.length === 0) {
    throw new Error(
      'No AI provider configured. Please set one of:\n' +
      '- ANTHROPIC_API_KEY (get at: https://console.anthropic.com)\n' +
      '- OPENAI_API_KEY (get at: https://platform.openai.com)\n' +
      '- OPENROUTER_API_KEY (free, get at: https://openrouter.ai/keys)\n' +
      '- Or install Ollama locally (free, get at: https://ollama.com)'
    )
  }

  console.log(`Available AI providers: ${availableProviders.map(p => p.name).join(', ')}`)

  // Try each provider in order
  for (const provider of availableProviders) {
    try {
      console.log(`\nAttempting ${provider.name}...`)
      return await provider.fn(transcript, dbContext)
    } catch (error: any) {
      console.error(`${provider.name} failed:`, error.message)
      // Continue to next provider
    }
  }

  throw new Error('All AI providers failed. Please check your API keys and try again.')
}
