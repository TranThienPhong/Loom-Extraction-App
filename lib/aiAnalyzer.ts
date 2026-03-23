import Anthropic from '@anthropic-ai/sdk'

export interface AIAnalysisResult {
  timestamp_seconds: number
  timestamp_label: string
  task_name: string
  task_description: string
}

/**
 * Analyzes a transcript using Claude AI to extract actionable tasks
 */
export async function analyzeTranscriptWithAI(
  transcript: Array<{ timestamp_seconds: number; timestamp_label: string; text: string }>
): Promise<AIAnalysisResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }

  const anthropic = new Anthropic({
    apiKey,
  })

  // Format the transcript for Claude
  const transcriptText = transcript
    .map(entry => `[${entry.timestamp_label}] ${entry.text}`)
    .join('\n')

  const prompt = `You are analyzing a video transcript where someone is providing feedback, requesting changes, or identifying issues that need to be fixed.

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

  try {
    console.log('Sending transcript to Claude for analysis...')
    
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    console.log('Claude response received:', responseText.substring(0, 200) + '...')

    // Parse the JSON response
    // Remove any markdown code fences if present
    const cleanedResponse = responseText
      .replace(/```json\n/g, '')
      .replace(/```\n/g, '')
      .replace(/```/g, '')
      .trim()

    const tasks = JSON.parse(cleanedResponse) as AIAnalysisResult[]

    console.log(`Extracted ${tasks.length} tasks from transcript`)
    return tasks
  } catch (error: any) {
    console.error('Error analyzing transcript with AI:', error)
    throw new Error(`AI analysis failed: ${error.message}`)
  }
}
