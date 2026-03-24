'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Task {
  timestamp_seconds: number
  timestamp_label: string
  task_name: string
  task_description: string
  image_url: string
  image_base64?: string // Base64 fallback for Railway/production
  loom_url: string
}

export default function Results() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [videoId, setVideoId] = useState('')
  const [imageErrors, setImageErrors] = useState<{[key: number]: boolean}>({})
  const router = useRouter()

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

      // Add image if available (try base64 first for Railway compatibility)
      const imageSource = task.image_base64 || task.image_url
      if (imageSource) {
        try {
          // Check if we need a new page for the image
          if (yPosition > 180) {
            doc.addPage()
            yPosition = 20
          }

          let base64: string
          
          // Use base64 if available, otherwise fetch the image
          if (task.image_base64) {
            base64 = task.image_base64
          } else {
            const response = await fetch(imageSource)
            const blob = await response.blob()
            base64 = await new Promise<string>((resolve) => {
              const reader = new FileReader()
              reader.onloadend = () => resolve(reader.result as string)
              reader.readAsDataURL(blob)
            })
          }

          // Add image to PDF (scaled to fit width of 170)
          const imgWidth = 170
          const imgHeight = 95 // 16:9 aspect ratio
          
          // Add the image with a clickable link overlay
          doc.addImage(base64, 'JPEG', 20, yPosition, imgWidth, imgHeight)
          
          // Add clickable transparent rectangle over the image
          doc.link(20, yPosition, imgWidth, imgHeight, { url: task.loom_url })
          
          yPosition += imgHeight + 3
          
          // Add clickable text link below image
          doc.setFontSize(9)
          doc.setTextColor(0, 0, 255)
          doc.textWithLink('🔗 Click image or this link to view in Loom', 20, yPosition, { url: task.loom_url })
          yPosition += 8
        } catch (error) {
          console.error('Error adding image to PDF:', error)
          // Fallback to text link if image fails
          doc.setTextColor(0, 0, 255)
          doc.textWithLink('🔗 View in Loom', 20, yPosition, { url: task.loom_url })
          yPosition += 10
        }
      } else {
        doc.setTextColor(0, 0, 255)
        doc.textWithLink('🔗 Watch in Loom', 20, yPosition, { url: task.loom_url })
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


                {(task.image_url || task.image_base64) && (
                  <a
                  href={task.loom_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block font-semibold transition-colors justify-items-end   "
                >
                  <div className="mb-4 border-2 border-gray-300">
                    <img
                      src={imageErrors[index] && task.image_base64 ? task.image_base64 : task.image_url}
                      alt={`Screenshot at ${task.timestamp_label}`}
                      className="w-full h-auto"
                      onError={() => {
                        // If image_url fails and we have base64, switch to it
                        if (task.image_base64) {
                          setImageErrors(prev => ({ ...prev, [index]: true }))
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
      </div>
    </div>
  )
}
