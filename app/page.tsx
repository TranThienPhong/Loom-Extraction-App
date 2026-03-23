'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const [loomUrl, setLoomUrl] = useState('')
  const [transcript, setTranscript] = useState('')
  const [loading, setLoading] = useState(false)
  const [useManualTranscript, setUseManualTranscript] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

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
        alert(`Error: ${data.error}`)
        setLoading(false)
      }
    } catch (error) {
      alert('An error occurred while processing the video')
      console.error(error)
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-gray-900 mb-4"></div>
          <h2 className="text-2xl font-semibold text-gray-900">Processing your Loom video...</h2>
          <p className="text-gray-600 mt-2">This may take a few minutes</p>
          <div className="mt-6 text-sm text-gray-500">
            <p>⏳ Downloading video...</p>
            <p>📝 Extracting transcript...</p>
            <p>🤖 Analyzing with AI...</p>
            <p>📸 Capturing screenshots...</p>
          </div>
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

        <div className="bg-white rounded-lg shadow-xl p-8">
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
                className="w-full px-4 py-3 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <p className="mt-2 text-sm text-gray-400">
                Paste a public Loom video link
              </p>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="manualTranscript"
                  checked={useManualTranscript}
                  onChange={(e) => setUseManualTranscript(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="manualTranscript" className="ml-2 block text-sm font-medium text-gray-700">
                  Paste transcript manually (optional)
                </label>
              </div>

              {useManualTranscript && (
                <div>
                  <label htmlFor="transcript" className="block text-sm font-medium text-gray-700 mb-2">
                    Video Transcript with Timestamps
                  </label>
                  <textarea
                    id="transcript"
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="0:05 - First issue I noticed is the header is misaligned
0:15 - The button color should be blue not green
0:23 - Loading spinner is missing on the submit button"
                    rows={10}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Format: "timestamp - description" on each line (e.g., "0:05 - Fix header alignment")
                  </p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!loomUrl}
              className="w-full bg-indigo-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              Process Video
            </button>
          </form>

          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">How it works:</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
              <li>Paste your Loom video URL</li>
              <li>AI analyzes the video to find all requested changes</li>
              <li>Screenshots are captured at each moment</li>
              <li>Export everything as a PDF with clickable timestamps</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
