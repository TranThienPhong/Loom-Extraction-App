import Anthropic from '@anthropic-ai/sdk'

export interface AIAnalysisResult {
  timestamp_seconds: number
  timestamp_label: string
  task_name: string
  task_description: string
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
export async function analyzeWithClaude(transcript: TranscriptEntry[]): Promise<AIAnalysisResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }

  const anthropic = new Anthropic({ apiKey })

  const transcriptText = transcript
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  const prompt = buildAnalysisPrompt(transcriptText)

  try {
    console.log('Using Anthropic Claude for AI analysis...')
    
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    return parseAIResponse(responseText)
  } catch (error: any) {
    console.error('Claude API error:', error.message)
    throw new Error(`Claude API failed: ${error.message}`)
  }
}

// OpenAI GPT-4 provider
export async function analyzeWithOpenAI(transcript: TranscriptEntry[]): Promise<AIAnalysisResult[]> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const transcriptText = transcript
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  const prompt = buildAnalysisPrompt(transcriptText)

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
export async function analyzeWithOpenRouter(transcript: TranscriptEntry[]): Promise<AIAnalysisResult[]> {
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set. Get free key at: https://openrouter.ai/keys')
  }

  const transcriptText = transcript
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  const prompt = buildAnalysisPrompt(transcriptText)

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
export async function analyzeWithOllama(transcript: TranscriptEntry[]): Promise<AIAnalysisResult[]> {
  const model = process.env.OLLAMA_MODEL || 'llama3.1'
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

  const transcriptText = transcript
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  const prompt = buildAnalysisPrompt(transcriptText)

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
function buildAnalysisPrompt(transcriptText: string): string {
  return `You are analyzing a video transcript where someone is providing feedback, requesting changes, or identifying issues that need to be fixed.

Your task: Extract EVERY moment where a task, fix, change, or improvement is mentioned or requested.

Here is the transcript with timestamps:

${transcriptText}

Instructions:
1. Identify each distinct task, fix, or change request
2. For each one, determine the timestamp when it was mentioned
3. Create a clear, actionable task name (5-10 words)
4. Write a detailed task description including all relevant context, URLs, screen names, UI elements, or specific details mentioned

Return ONLY a JSON array with no additional text, explanation, or markdown formatting. Each object must have exactly these fields:
{
  "timestamp_seconds": <number>,
  "timestamp_label": "<M:SS format>",
  "task_name": "<short descriptive title>",
  "task_description": "<detailed description with all context>"
}

Example output format:
[
  {
    "timestamp_seconds": 44,
    "timestamp_label": "0:44",
    "task_name": "Fix header alignment on mobile",
    "task_description": "The header navigation is not centered properly on mobile devices. It appears shifted to the left by about 10 pixels. This is visible on the home page when viewing on iPhone."
  }
]

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
    return tasks
  } catch (error) {
    console.error('Failed to parse AI response:', error)
    throw new Error('AI returned invalid JSON format. Please try again.')
  }
}

/**
 * Main function: tries providers in order until one succeeds
 */
export async function analyzeTranscriptWithAI(transcript: TranscriptEntry[]): Promise<AIAnalysisResult[]> {
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
      return await provider.fn(transcript)
    } catch (error: any) {
      console.error(`${provider.name} failed:`, error.message)
      // Continue to next provider
    }
  }

  throw new Error('All AI providers failed. Please check your API keys and try again.')
}
