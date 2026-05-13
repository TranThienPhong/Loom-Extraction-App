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
}

export interface TranscriptEntry {
  timestamp_seconds: number
  timestamp_label: string
  text: string
}

/**
 * Multi-provider AI analyzer
 * Supports: Anthropic Claude, OpenAI GPT-4, OpenRouter (free), and Ollama (local)
 */

// Anthropic Claude provider
export async function analyzeWithClaude(transcript: TranscriptEntry[], dbContext = ''): Promise<AIAnalysisResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }

  const anthropic = new Anthropic({ apiKey })

  const transcriptText = transcript
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  const prompt = buildAnalysisPrompt(transcriptText, dbContext)

  const MAX_RETRIES = 4
  const RETRY_DELAY_MS = [5000, 10000, 20000, 30000]

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Using Anthropic Claude for AI analysis... (attempt ${attempt}/${MAX_RETRIES})`)

      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16384,
        messages: [{ role: 'user', content: prompt }],
      })

      const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
      return parseAIResponse(responseText)
    } catch (error: any) {
      const isOverloaded = error.status === 529 || (typeof error.message === 'string' && error.message.includes('overloaded'))
      const isRateLimit = error.status === 429 || (typeof error.message === 'string' && error.message.includes('rate_limit'))
      const shouldRetry = (isOverloaded || isRateLimit) && attempt < MAX_RETRIES

      if (shouldRetry) {
        const delay = RETRY_DELAY_MS[attempt - 1]
        console.warn(`Claude overloaded/rate-limited (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      console.error('Claude API error:', error.message)
      throw new Error(`Claude API failed: ${error.message}`)
    }
  }

  throw new Error('Claude API failed after all retries')
}

// OpenAI GPT-4 provider
export async function analyzeWithOpenAI(transcript: TranscriptEntry[], dbContext = ''): Promise<AIAnalysisResult[]> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const transcriptText = transcript
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  const prompt = buildAnalysisPrompt(transcriptText, dbContext)

  try {
    console.log('Using OpenAI GPT-4 for AI analysis...')
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
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

  const transcriptText = transcript
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  const prompt = buildAnalysisPrompt(transcriptText, dbContext)

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

  const transcriptText = transcript
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  const prompt = buildAnalysisPrompt(transcriptText, dbContext)

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
function buildAnalysisPrompt(transcriptText: string, dbContext = ''): string {
  return `You are analyzing a video transcript where someone is providing feedback, requesting changes, or identifying issues that need to be fixed.

Your task: Extract EVERY moment where a task, fix, change, or improvement is mentioned or requested.
${dbContext ? '\n' + dbContext + '\n' : ''}
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
7. Priority: 1.1-4.9 scale (1.x=GAME OVER, 2.x=MAJOR LOSS, 3.x=MAJOR GAIN, 4.x=NICE-TO-HAVE). Default 3.0 if not stated.
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
  "task_type": "<Need-to-have|Nice-to-have>"
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
    "task_type": "Nice-to-have"
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
 * Generate a brief summary of the video based on the transcript
 */
export async function generateVideoSummary(transcript: TranscriptEntry[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return ''

  const anthropic = new Anthropic({ apiKey })

  // Use first 80 entries max (faster, cheaper for summary)
  const sampleEntries = transcript.slice(0, 80)
  const transcriptText = sampleEntries
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Based on this video transcript excerpt, write a concise 2-3 sentence summary of what the video is about. Focus on the main purpose, who is speaking, and what they are reviewing or providing feedback on. Be specific about the product or feature being discussed.

Transcript:
${transcriptText}

Write only the summary, no preamble.`
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
    { name: 'Ollama (Local)', fn: analyzeWithOllama, envCheck: () => true }, // Always available if running
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
