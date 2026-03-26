'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getProcessingResults } from '@/lib/imageStorage'

// Utility function to generate Loom URL with timestamp (moved inline to avoid server-side imports)
function generateLoomUrlWithTimestamp(videoId: string, timestampSeconds: number): string {
  return `https://www.loom.com/share/${videoId}?t=${timestampSeconds}`
}

interface Screenshot {
  timestamp_seconds: number
  timestamp_label: string
  image_url: string
  image_base64?: string
}

interface Task {
  timestamp_seconds: number
  timestamp_label: string
  task_name: string
  task_description: string
  image_url: string
  image_base64?: string // Base64 fallback for Railway/production (backward compatibility)
  screenshots?: Screenshot[] // Multiple screenshots per task
  loom_url: string
}

export default function Results() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [videoId, setVideoId] = useState('')
  const [imageErrors, setImageErrors] = useState<{[key: string | number]: boolean}>({})
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const  [lightboxTimestamp, setLightboxTimestamp] = useState<string>('')
  const [lightboxIndex, setLightboxIndex] = useState<number>(0)
  const [currentTaskScreenshots, setCurrentTaskScreenshots] = useState<Screenshot[]>([])
  const [debugInfo, setDebugInfo] = useState<string>('')
  const router = useRouter()

  // Helper function to convert image URL to base64 for PDF export (fallback for local dev)
  const imageUrlToBase64 = async (url: string): Promise<string> => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } catch (error) {
      console.error('Failed to convert image to base64:', error)
      throw error
    }
  }

  // Keyboard navigation for lightbox (with inline navigation logic to avoid stale closure)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!lightboxImage || currentTaskScreenshots.length === 0) return
      
      if (e.key === 'ArrowLeft' || e.key === 'Left') {
        // Previous image
        const newIndex = (lightboxIndex - 1 + currentTaskScreenshots.length) % currentTaskScreenshots.length
        setLightboxIndex(newIndex)
        const screenshot = currentTaskScreenshots[newIndex]
        setLightboxImage(screenshot.image_base64 || screenshot.image_url)
        setLightboxTimestamp(screenshot.timestamp_label)
      } else if (e.key === 'ArrowRight' || e.key === 'Right') {
        // Next image
        const newIndex = (lightboxIndex + 1) % currentTaskScreenshots.length
        setLightboxIndex(newIndex)
        const screenshot = currentTaskScreenshots[newIndex]
        setLightboxImage(screenshot.image_base64 || screenshot.image_url)
        setLightboxTimestamp(screenshot.timestamp_label)
      } else if (e.key === 'Escape') {
        setLightboxImage(null)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [lightboxImage, lightboxIndex, currentTaskScreenshots])

  useEffect(() => {
    const loadResults = async () => {
      console.log('[Results] 🔍 Loading processing results...')
      let loadedTasks = []
      let loadedVideoId = ''
      
      // Try BOTH storage methods and use whatever works
      
      // Method 1: sessionStorage (fastest, try first)
      try {
        const resultsData = sessionStorage.getItem('loomResults')
        if (resultsData) {
          const data = JSON.parse(resultsData)
          console.log('[Results] 📦 sessionStorage found:', data.tasks?.length, 'tasks')
          if (data.tasks && data.tasks.length > 0) {
            const firstTask = data.tasks[0]
            console.log('[Results] First task has base64:', !!firstTask.image_base64)
            console.log('[Results] First task screenshots:', firstTask.screenshots?.length || 0)
            if (firstTask.screenshots && firstTask.screenshots.length > 0) {
              console.log('[Results] First screenshot has base64:', !!firstTask.screenshots[0].image_base64, 'length:', firstTask.screenshots[0].image_base64?.length || 0)
            }
            loadedTasks = data.tasks
            loadedVideoId = data.videoId
          }
        }
      } catch (error) {
        console.warn('[Results] ⚠️ sessionStorage failed:', error)
      }
      
      // Method 2: IndexedDB (PRIORITIZE - always try if no images in sessionStorage)
      if (loadedTasks.length === 0 || (loadedTasks[0] && (!loadedTasks[0].screenshots || !loadedTasks[0].screenshots[0]?.image_base64))) {
        try {
          console.log('[Results] 🔄 Trying IndexedDB (no images in sessionStorage)...')
          const indexedDBData = await getProcessingResults()
          if (indexedDBData && indexedDBData.tasks) {
            console.log('[Results] 📦 IndexedDB found:', indexedDBData.tasks.length, 'tasks')
            if (indexedDBData.tasks.length > 0) {
              const firstTask = indexedDBData.tasks[0]
              console.log('[Results] IndexedDB first task has base64:', !!firstTask.image_base64)
              if (firstTask.screenshots && firstTask.screenshots.length > 0) {
                console.log('[Results] IndexedDB first screenshot has base64:', !!firstTask.screenshots[0].image_base64)
              }
            }
            loadedTasks = indexedDBData.tasks
            loadedVideoId = indexedDBData.videoId
          }
        } catch (error) {
          console.error('[Results] ❌ IndexedDB failed:', error)
        }
      }

      // Check if we have data
      if (loadedTasks.length === 0) {
        console.error('[Results] ❌ NO DATA FOUND in any storage')
        alert('No results found. Please try processing the video again.')
        router.push('/')
        return
      }

      console.log('[Results] ✅ Setting', loadedTasks.length, 'tasks')
      setTasks(loadedTasks)
      setVideoId(loadedVideoId)
      
      // Build debug info for display
      let debug = `📊 Storage Debug Info:\n`
      debug += `✅ Loaded ${loadedTasks.length} tasks\n`
      loadedTasks.forEach((task: Task, i: number) => {
        debug += `\nTask ${i + 1}: ${task.task_name}\n`
        debug += `  - Primary image: ${task.image_base64 ? '✅ ' + (task.image_base64.length / 1024).toFixed(1) + 'KB' : '❌ Missing'}\n`
        debug += `  - Screenshots: ${task.screenshots?.length || 0}\n`
        if (task.screenshots) {
          task.screenshots.forEach((s: Screenshot, j: number) => {
            debug += `    ${j + 1}. ${s.timestamp_label}: ${s.image_base64 ? '✅ ' + (s.image_base64.length / 1024).toFixed(1) + 'KB' : '❌ Missing'}\n`
          })
        }
      })
      setDebugInfo(debug)
      
      // Debug: Log what we're about to render
      setTimeout(() => {
        console.log('[Results] 🎨 Rendering tasks:', loadedTasks.length)
        loadedTasks.forEach((task: Task, i: number) => {
          console.log(`[Results] Task ${i + 1}:`, {
            name: task.task_name,
            hasBase64: !!task.image_base64,
            screenshotCount: task.screenshots?.length || 0,
            firstScreenshotHasBase64: task.screenshots?.[0]?.image_base64 ? true : false
          })
        })
      }, 100)
    }

    loadResults()
  }, [router])

  const handleExportPDF = async () => {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF()
    
    let yPosition = 20

    doc.setFontSize(20)
    doc.text('Loom Video Tasks', 20, yPosition)
    yPosition += 15

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      
      // Check if we need a new page before adding content
      if (yPosition > 220) {
        doc.addPage()
        yPosition = 20
      }

      // Task number and name
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text(`${i + 1}. ${task.task_name}`, 20, yPosition)
      yPosition += 7

      // Timestamp
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100, 100, 100)
      doc.text(`⏱ ${task.timestamp_label}`, 20, yPosition)
      yPosition += 7

      // Description
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(11)
      const splitDescription = doc.splitTextToSize(task.task_description, 170)
      doc.text(splitDescription, 20, yPosition)
      yPosition += splitDescription.length * 5 + 5

      // Add images to PDF
      const screenshotsToExport = task.screenshots && task.screenshots.length > 0
        ? task.screenshots
        : (task.image_url || task.image_base64)
          ? [{ 
              image_url: task.image_url,
              image_base64: task.image_base64,
              timestamp_label: task.timestamp_label,
              timestamp_seconds: task.timestamp_seconds
            }]
          : []

      if (screenshotsToExport.length > 0) {
        for (let s = 0; s < screenshotsToExport.length; s++) {
          const screenshot = screenshotsToExport[s]
          const imageSource = screenshot.image_base64 || screenshot.image_url
          
          if (!imageSource) continue

          try {
            // Check if we need a new page for the image
            if (yPosition > 180) {
              doc.addPage()
              yPosition = 20
            }

            // Get base64: use existing if available, otherwise fetch and convert
            const base64 = screenshot.image_base64 || await imageUrlToBase64(imageSource)

            // Add image to PDF (scaled to fit width of 170)
            const imgWidth = 170
            const imgHeight = 95 // 16:9 aspect ratio
            
            // Add screenshot label if multiple
            if (screenshotsToExport.length > 1) {
              doc.setFontSize(9)
              doc.setTextColor(100, 100, 100)
              doc.text(`Screenshot ${s + 1}/${screenshotsToExport.length} at ${screenshot.timestamp_label}`, 20, yPosition)
              yPosition += 4
            }
            
            // Add the image with a clickable link overlay
            doc.addImage(base64, 'JPEG', 20, yPosition, imgWidth, imgHeight)
            
            // Add clickable transparent rectangle over the image
            const screenshotLoomUrl = screenshot.timestamp_seconds 
              ? generateLoomUrlWithTimestamp(videoId, screenshot.timestamp_seconds)
              : task.loom_url
            doc.link(20, yPosition, imgWidth, imgHeight, { url: screenshotLoomUrl })
            
            yPosition += imgHeight + 3
            
            // Add clickable text link below image
            doc.setFontSize(9)
            doc.setTextColor(0, 0, 255)
            const linkText = screenshotsToExport.length > 1 
              ? `🔗 View screenshot ${s + 1} in Loom`
              : '🔗 Click image or this link to view in Loom'
            doc.textWithLink(linkText, 20, yPosition, { url: screenshotLoomUrl })
            yPosition += 5
            
            // Add direct Loom link as requested by boss
            doc.setFontSize(8)
            doc.setTextColor(100, 100, 100)
            doc.text(`Direct link: ${screenshotLoomUrl}`, 20, yPosition)
            yPosition += 8
          } catch (error) {
            console.error('Error adding image to PDF:', error)
            // Continue to next screenshot if one fails
          }
        }
      } else {
        // No images available, add text link only
        doc.setFontSize(9)
        doc.setTextColor(0, 0, 255)
        doc.textWithLink('🔗 View in Loom', 20, yPosition, { url: task.loom_url })
        yPosition += 10
      }

      yPosition += 10
    }

    doc.save('loom-tasks.pdf')
  }

  if (tasks.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Loading results...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Extracted Tasks</h1>
            <p className="text-gray-600 mt-2">{tasks.length} task{tasks.length !== 1 ? 's' : ''} found</p>
          </div>
          <div className="space-x-4">
            <button
              onClick={handleExportPDF}
              className="bg-green-600 text-white px-6 py-3 font-semibold hover:bg-green-700 transition-colors border-2 border-green-700"
            >
              📄 Export PDF
            </button>
            <button
              onClick={() => router.push('/')}
              className="bg-gray-200 text-gray-700 px-6 py-3 font-semibold hover:bg-gray-300 transition-colors border-2 border-gray-300"
            >
              ← New Video
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {tasks.map((task, index) => (
            <div
              key={index}
              className="bg-white shadow-md overflow-hidden hover:shadow-xl transition-shadow border-2 border-gray-200"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">
                      {index + 1}. {task.task_name} <span></span><span className="inline-block bg-indigo-100 text-indigo-800 text-lg font-semibold px-3 py-1 border-2 ml-[0.2rem] border-indigo-300">
                      ⏱ {task.timestamp_label}
                    </span>
                    </h2>
                    
                  </div>
                </div>

                <p className="text-gray-700 mb-4 leading-relaxed">
                  {task.task_description}
                </p>

                {/* Image Gallery - Show all screenshots if available */}
                {task.screenshots && task.screenshots.length > 0 ? (
                  <div className="mb-4">
                    <p className="text-sm font-semibold text-gray-600 mb-2">
                      Screenshots ({task.screenshots.length})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {task.screenshots.map((screenshot, screenshotIndex) => (
                        <div key={screenshotIndex} className="border-2 border-gray-300 hover:border-indigo-500 transition-colors cursor-pointer group relative">
                          <img
                            src={screenshot.image_base64 || screenshot.image_url}
                            alt={`Screenshot at ${screenshot.timestamp_label}`}
                            className="w-full h-auto"
                            onClick={() => {
                              setCurrentTaskScreenshots(task.screenshots || [])
                              setLightboxIndex(screenshotIndex)
                              setLightboxImage(screenshot.image_base64 || screenshot.image_url)
                              setLightboxTimestamp(screenshot.timestamp_label)
                            }}
                            onError={(e) => {
                              // Fallback: if image_url fails and we have base64, use it
                              if (screenshot.image_base64 && e.currentTarget.src !== screenshot.image_base64) {
                                e.currentTarget.src = screenshot.image_base64
                              } else {
                                console.error(`Failed to load screenshot: ${screenshot.image_url}`)
                              }
                            }}
                          />
                          {/* Permanent timestamp overlay - bottom left (clickable to go to Loom) */}
                          <a
                            href={screenshot.timestamp_seconds 
                              ? generateLoomUrlWithTimestamp(videoId, screenshot.timestamp_seconds)
                              : task.loom_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="absolute bottom-2 left-2 bg-black bg-opacity-80 hover:bg-opacity-95 text-white text-sm font-bold py-1 px-3 rounded border border-black shadow-lg transition-all z-10"
                          >
                            ⏱ {screenshot.timestamp_label}
                          </a>
                          {/* Hover overlay - centered */}
                          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center pointer-events-none">
                            <span className="text-white font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                              🔍 Click to enlarge
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (task.image_base64 || task.image_url) && (
                  /* Fallback to single image for backward compatibility */
                  <a
                  href={task.loom_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block font-semibold transition-colors justify-items-end   "
                >
                  <div className="mb-4 border-2 border-gray-300">
                    <img
                      src={task.image_base64 || task.image_url}
                      alt={`Screenshot at ${task.timestamp_label}`}
                      className="w-full h-auto"
                      onError={(e) => {
                        // Fallback: try base64 if URL fails
                        if (task.image_base64 && e.currentTarget.src !== task.image_base64) {
                          e.currentTarget.src = task.image_base64
                        } else {
                          console.error(`Failed to load image: ${task.image_url}`)
                        }
                      }}
                    />
                  </div>
                  </a>
                )}

                <a
                  href={task.loom_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-indigo-600 text-white px-6 py-3 font-semibold hover:bg-indigo-700 transition-colors justify-items-end border-2 border-indigo-700"
                >
                  Watch in Loom
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Lightbox Modal for Full-Size Image Inspection with Navigation */}
        {lightboxImage && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
            onClick={() => setLightboxImage(null)}
          >
            <div className="relative max-w-7xl w-full">
              {/* Close button */}
              <button
                onClick={() => setLightboxImage(null)}
                className="absolute top-3 right-4 text-gray-400 text-4xl font-bold hover:text-gray-300 z-10 rounded-full w-12 h-12 flex items-center justify-center"
              >
                ×
              </button>

              {/* Previous arrow - only show if multiple screenshots */}
              {currentTaskScreenshots.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const newIndex = (lightboxIndex - 1 + currentTaskScreenshots.length) % currentTaskScreenshots.length
                    setLightboxIndex(newIndex)
                    const screenshot = currentTaskScreenshots[newIndex]
                    setLightboxImage(screenshot.image_base64 || screenshot.image_url)
                    setLightboxTimestamp(screenshot.timestamp_label)
                  }}
                  className="absolute left-4 top-1/2 transform -translate-x-[5rem] -translate-y-1/2 text-gray text-5xl font-bold hover:text-gray-300 z-10 w-14 h-14 flex items-center justify-center"
                  aria-label="Previous image"
                >
                  ‹
                </button>
              )}

              {/* Next arrow - only show if multiple screenshots */}
              {currentTaskScreenshots.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const newIndex = (lightboxIndex + 1) % currentTaskScreenshots.length
                    setLightboxIndex(newIndex)
                    const screenshot = currentTaskScreenshots[newIndex]
                    setLightboxImage(screenshot.image_base64 || screenshot.image_url)
                    setLightboxTimestamp(screenshot.timestamp_label)
                  }}
                  className="absolute right-4 top-1/2 transform translate-x-[5rem] -translate-y-1/2 text-gray text-5xl font-bold hover:text-gray-300 z-10 w-14 h-14 flex items-center justify-center"
                  aria-label="Next image"
                >
                  ›
                </button>
              )}

              <div className="bg-white p-2 rounded-lg">
                <img
                  src={lightboxImage}
                  alt={`Full size screenshot at ${lightboxTimestamp}`}
                  className="w-full h-auto max-h-[90vh] object-contain"
                  onClick={(e) => e.stopPropagation()}
                />
                <p className="text-center mt-2 text-gray-700 font-semibold">
                  ⏱ {lightboxTimestamp}
                  {currentTaskScreenshots.length > 1 && (
                    <span className="ml-3 text-gray-500 text-sm">
                      ({lightboxIndex + 1} of {currentTaskScreenshots.length})
                    </span>
                  )}
                </p>
              </div>
              {/* <p className="text-white text-center mt-4 text-sm">
                {currentTaskScreenshots.length > 1 ? 'Use arrow buttons or click outside to close' : 'Click outside image or X button to close'}
              </p> */}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
