'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

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
  const [lightboxTimestamp, setLightboxTimestamp] = useState<string>('')
  const router = useRouter()

  // Helper function to convert image URL to base64 for PDF export
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

  useEffect(() => {
    const resultsData = sessionStorage.getItem('loomResults')
    if (!resultsData) {
      router.push('/')
      return
    }

    const data = JSON.parse(resultsData)
    setTasks(data.tasks || [])
    setVideoId(data.videoId || '')
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
        : task.image_url 
          ? [{ 
              image_url: task.image_url, 
              timestamp_label: task.timestamp_label,
              timestamp_seconds: task.timestamp_seconds
            }]
          : []

      if (screenshotsToExport.length > 0) {
        for (let s = 0; s < screenshotsToExport.length; s++) {
          const screenshot = screenshotsToExport[s]
          const imageSource = screenshot.image_url
          
          if (!imageSource) continue

          try {
            // Check if we need a new page for the image
            if (yPosition > 180) {
              doc.addPage()
              yPosition = 20
            }

            // Fetch and convert image to base64 for PDF embedding
            const base64 = await imageUrlToBase64(imageSource)

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
                            src={screenshot.image_url}
                            alt={`Screenshot at ${screenshot.timestamp_label}`}
                            className="w-full h-auto"
                            onClick={() => {
                              setLightboxImage(screenshot.image_url)
                              setLightboxTimestamp(screenshot.timestamp_label)
                            }}
                            onError={() => {
                              console.error(`Failed to load screenshot: ${screenshot.image_url}`)
                            }}
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 text-white text-xs py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            ⏱ {screenshot.timestamp_label} • Click to enlarge
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : task.image_url && (
                  /* Fallback to single image for backward compatibility */
                  <a
                  href={task.loom_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block font-semibold transition-colors justify-items-end   "
                >
                  <div className="mb-4 border-2 border-gray-300">
                    <img
                      src={task.image_url}
                      alt={`Screenshot at ${task.timestamp_label}`}
                      className="w-full h-auto"
                      onError={() => {
                        console.error(`Failed to load image: ${task.image_url}`)
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

        {/* Lightbox Modal for Full-Size Image Inspection */}
        {lightboxImage && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
            onClick={() => setLightboxImage(null)}
          >
            <div className="relative max-w-7xl w-full">
              <button
                onClick={() => setLightboxImage(null)}
                className="absolute top-4 right-4 text-white text-4xl font-bold hover:text-gray-300 z-10"
              >
                ×
              </button>
              <div className="bg-white p-2 rounded-lg">
                <img
                  src={lightboxImage}
                  alt={`Full size screenshot at ${lightboxTimestamp}`}
                  className="w-full h-auto max-h-[90vh] object-contain"
                  onClick={(e) => e.stopPropagation()}
                />
                <p className="text-center mt-2 text-gray-700 font-semibold">
                  ⏱ {lightboxTimestamp}
                </p>
              </div>
              <p className="text-white text-center mt-4 text-sm">
                Click outside image or X button to close
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
