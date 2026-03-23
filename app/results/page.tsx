'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Task {
  timestamp_seconds: number
  timestamp_label: string
  task_name: string
  task_description: string
  image_url: string
  loom_url: string
}

export default function Results() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [videoId, setVideoId] = useState('')
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
      
      // Check if we need a new page
      if (yPosition > 250) {
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

      // Add image if available
      if (task.image_url) {
        try {
          // Add clickable link on the image
          doc.setTextColor(0, 0, 255)
          doc.textWithLink('🔗 Click to view in Loom', 20, yPosition, { url: task.loom_url })
          yPosition += 10

          // Add image (you'd need to convert it to base64 or use a public URL)
          // For now, we'll just add the link
        } catch (error) {
          console.error('Error adding image:', error)
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
              className="bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors"
            >
              📄 Export PDF
            </button>
            <button
              onClick={() => router.push('/')}
              className="bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              ← New Video
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {tasks.map((task, index) => (
            <div
              key={index}
              className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">
                      {index + 1}. {task.task_name}
                    </h2>
                    <span className="inline-block bg-indigo-100 text-indigo-800 text-sm font-medium px-3 py-1 rounded-full">
                      ⏱ {task.timestamp_label}
                    </span>
                  </div>
                </div>

                <p className="text-gray-700 mb-4 leading-relaxed">
                  {task.task_description}
                </p>

                {task.image_url && (
                  <div className="relative mb-4 group">
                    <img
                      src={task.image_url}
                      alt={`Screenshot at ${task.timestamp_label}`}
                      className="w-full h-auto rounded-lg"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 rounded-b-lg">
                      <span className="text-white text-2xl font-bold drop-shadow-lg">
                        {task.timestamp_label}
                      </span>
                    </div>
                  </div>
                )}

                <a
                  href={task.loom_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
                >
                  🎥 Watch in Loom
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
