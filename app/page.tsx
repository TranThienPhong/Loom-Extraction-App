'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const [loomUrl, setLoomUrl] = useState('')
  const [transcript, setTranscript] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{message: string, needsManualTranscript?: boolean} | null>(null)
  const [useManualTranscript, setUseManualTranscript] = useState(false)
  const router = useRouter()

  // Auto-show manual transcript option when API fails
  useEffect(() => {
    if (error?.needsManualTranscript) {
      setUseManualTranscript(true)
    }
  }, [error])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/process-loom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          loomUrl,
          manualTranscript: useManualTranscript ? transcript : null,
        }),
      })

      const data = await response.json()
      
      if (response.ok) {
        // Store results in sessionStorage for the results page
        sessionStorage.setItem('loomResults', JSON.stringify(data))
        router.push('/results')
      } else {
        setError({
          message: data.error || 'An error occurred while processing the video',
          needsManualTranscript: data.needsManualTranscript
        })
        setLoading(false)
      }
    } catch (error) {
      setError({message: 'An error occurred while processing the video'})
      console.error(error)
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block w-16 h-16 mb-4">
            <div className="w-full h-full border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">Processing your Loom video...</h2>
          <p className="text-gray-600 mt-2">This may take a few minutes</p>

        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Loom Extraction App
          </h1>
          <p className="text-xl text-gray-600">
            Turn your Loom video feedback into actionable tasks automatically
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-6 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-red-800">
                  {error.needsManualTranscript ? '⚠️ Auto-Extraction Failed' : 'Error Processing Video'}
                </h3>
                <div className="mt-2 text-sm text-red-700 whitespace-pre-wrap">
                  {error.message}
                </div>
                {error.needsManualTranscript && (
                  <div className="mt-4 p-3 bg-yellow-50 border-2 border-yellow-300 text-sm">
                    <p className="font-semibold text-yellow-900">💡 Solution: Use Manual Transcript</p>
                    <p className="text-yellow-800 mt-1">The automatic transcript extraction failed (Loom API may be blocked or unavailable). Please enable the "Use manual transcript" option below and paste your transcript manually.</p>
                  </div>
                )}
                {error.message.includes('yt-dlp') && (
                  <div className="mt-4 text-sm text-red-700">
                    <p className="font-semibold">To install yt-dlp:</p>
                    <code className="block mt-2 bg-red-100 p-2 text-xs">
                      sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
                    </code>
                  </div>
                )}
                {error.message.includes('ffmpeg') && (
                  <div className="mt-4 text-sm text-red-700">
                    <p className="font-semibold">To install ffmpeg:</p>
                    <code className="block mt-2 bg-red-100 p-2 text-xs">
                      sudo apt-get update && sudo apt-get install ffmpeg
                    </code>
                  </div>
                )}
              </div>
              <button
                onClick={() => setError(null)}
                className="ml-3 flex-shrink-0 text-red-500 hover:text-red-700"
              >
                <span className="sr-only">Dismiss</span>
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div className="bg-white shadow-xl p-8 border border-gray-200">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="loomUrl" className="block text-sm font-medium text-gray-700 mb-2">
                Loom Video URL
              </label>
              <input
                type="url"
                id="loomUrl"
                value={loomUrl}
                onChange={(e) => setLoomUrl(e.target.value)}
                placeholder="https://www.loom.com/share/..."
                required
                className="w-full px-4 py-3 text-gray-900 border-2 border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <p className="mt-2 text-sm text-gray-500">
                Paste a public Loom video link
              </p>
            </div>

            <div className="border-t-2 border-gray-200 pt-6">
              <div className="bg-blue-50 border-blue-500 p-4 mb-4">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">🔄 What is Manual Transcript?</h3>
                <p className="text-sm text-blue-800 mb-2">
                  By default, the app automatically extracts the transcript from your Loom video. However, if automatic extraction fails (due to API limitations or blocked access), you can manually paste the transcript here.
                </p>
                <p className="text-sm text-blue-800">
                  <strong>When to use:</strong> Only enable this if automatic extraction fails or if you want to provide a custom transcript.
                </p>
              </div>
              
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="manualTranscript"
                  checked={useManualTranscript}
                  onChange={(e) => setUseManualTranscript(e.target.checked)}
                  className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                  style={{borderRadius: 0}}
                />
                <label htmlFor="manualTranscript" className="ml-3 block text-sm font-medium text-gray-700">
                  Use manual transcript {error?.needsManualTranscript && <span className="text-red-600 font-bold">(⚠️ Required - Auto-extraction failed)</span>}
                </label>
              </div>

              {useManualTranscript && (
                <div>
                  <label htmlFor="transcript" className="block text-sm font-medium text-gray-700 mb-2">
                    Video Transcript
                  </label>
                  <textarea
                    id="transcript"
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="0:05 - First issue I noticed is the header is misaligned
0:15 - The button color should be blue not green
0:23 - Loading spinner is missing on the submit button

You can also paste plain text without timestamps - we'll assign them automatically!"
                    rows={10}
                    className="w-full px-4 py-3 text-gray-900 border-2 border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                  />
                  <div className="mt-3 p-4 bg-blue-50 border-2 border-blue-200">
                    <p className="text-sm font-semibold text-blue-900 mb-2">📋 How to Get Your Loom Transcript:</p>
                    <ol className="text-sm text-blue-800 space-y-1 ml-4 list-decimal">
                      <li>Open your Loom video in a browser</li>
                      <li>Click on the <strong>Transcript</strong> → <strong>Copy</strong></li>
                      <li>Patse the transcript <strong>here</strong></li>
                      <li>Or use a transcript service like <strong>otter.ai</strong> or <strong>Descript</strong></li>
                    </ol>
                    <p className="text-sm text-blue-700 mt-3">
                      <strong>Flexible formats:</strong> "0:05 - text", "[0:05] text", "At 0:05 text", or plain text without timestamps
                    </p>
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!loomUrl}
              className="w-full bg-indigo-600 text-white py-4 px-6 font-semibold text-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              Process Video
            </button>
          </form>

          <div className="mt-8 p-4 bg-gray-100 border-l-4 border-indigo-600">
            <h3 className="font-semibold text-gray-900 mb-3 text-lg">📖 How it works:</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
              <li><strong>Paste your Loom video URL</strong> - Just copy and paste the link</li>
              <li><strong>Automatic transcript extraction</strong> - The app pulls the video transcript automatically</li>
              <li><strong>AI analysis</strong> - AI identifies every task, change request, or feedback point</li>
              <li><strong>Screenshot capture</strong> - Screenshots are captured at each timestamp with the time burned into the image</li>
              <li><strong>Export as PDF</strong> - Get a professional PDF with clickable screenshots linking directly to the video moments</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
