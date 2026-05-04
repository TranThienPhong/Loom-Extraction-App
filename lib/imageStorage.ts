/**
 * Image Storage Helper for Railway Deployment
 * 
 * Problem: sessionStorage has ~5-10MB limit, but our base64 images are large (185KB each)
 * With multiple screenshots per task, we easily exceed quota
 * 
 * Solution: Use IndexedDB which has 50MB+ quota and works on Railway
 */

interface StoredImage {
  id: string
  base64: string
  timestamp: number
}

interface TaskData {
  videoId: string
  summary?: string
  tasks: any[]
  timestamp: number
}

class ImageStorageManager {
  private dbName = 'loomExtractorDB'
  private dbVersion = 1
  private imagesStoreName = 'images'
  private tasksStoreName = 'tasks'
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create images store
        if (!db.objectStoreNames.contains(this.imagesStoreName)) {
          const imagesStore = db.createObjectStore(this.imagesStoreName, { keyPath: 'id' })
          imagesStore.createIndex('timestamp', 'timestamp', { unique: false })
        }

        // Create tasks store
        if (!db.objectStoreNames.contains(this.tasksStoreName)) {
          const tasksStore = db.createObjectStore(this.tasksStoreName, { keyPath: 'videoId' })
          tasksStore.createIndex('timestamp', 'timestamp', { unique: false })
        }
      }
    })
  }

  async storeTaskData(videoId: string, tasks: any[], summary?: string): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tasksStoreName], 'readwrite')
      const store = transaction.objectStore(this.tasksStoreName)

      const data: TaskData = {
        videoId,
        summary,
        tasks,
        timestamp: Date.now()
      }

      const request = store.put(data)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getTaskData(videoId: string): Promise<TaskData | null> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tasksStoreName], 'readonly')
      const store = transaction.objectStore(this.tasksStoreName)
      const request = store.get(videoId)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async storeImage(id: string, base64: string): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.imagesStoreName], 'readwrite')
      const store = transaction.objectStore(this.imagesStoreName)

      const image: StoredImage = {
        id,
        base64,
        timestamp: Date.now()
      }

      const request = store.put(image)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getImage(id: string): Promise<string | null> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.imagesStoreName], 'readonly')
      const store = transaction.objectStore(this.imagesStoreName)
      const request = store.get(id)

      request.onsuccess = () => {
        const result = request.result as StoredImage | undefined
        resolve(result ? result.base64 : null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async clearOldData(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    if (!this.db) await this.init()

    const cutoffTime = Date.now() - maxAgeMs

    // Clear old images
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([this.imagesStoreName], 'readwrite')
      const store = transaction.objectStore(this.imagesStoreName)
      const index = store.index('timestamp')
      const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      request.onerror = () => reject(request.error)
    })

    // Clear old tasks
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([this.tasksStoreName], 'readwrite')
      const store = transaction.objectStore(this.tasksStoreName)
      const index = store.index('timestamp')
      const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      request.onerror = () => reject(request.error)
    })
  }
}

// Singleton instance
export const imageStorage = new ImageStorageManager()

/**
 * Helper function to store complete processing results
 * This replaces sessionStorage for large data
 */
export async function storeProcessingResults(data: any): Promise<void> {
  try {
    console.log('[ImageStorage] Storing processing results with IndexedDB')
    
    // Store main task data (without base64 to keep it lightweight)
    const tasksWithoutBase64 = data.tasks.map((task: any) => ({
      ...task,
      image_base64: undefined,
      screenshots: task.screenshots?.map((s: any) => ({
        ...s,
        image_base64: undefined
      }))
    }))

    await imageStorage.storeTaskData(data.videoId, tasksWithoutBase64, data.summary)

    // Store each base64 image separately in IndexedDB
    for (let i = 0; i < data.tasks.length; i++) {
      const task = data.tasks[i]
      
      // Store primary image
      if (task.image_base64) {
        const imageId = `${data.videoId}_task${i}_primary`
        await imageStorage.storeImage(imageId, task.image_base64)
      }

      // Store screenshot images
      if (task.screenshots) {
        for (let j = 0; j < task.screenshots.length; j++) {
          const screenshot = task.screenshots[j]
          if (screenshot.image_base64) {
            const imageId = `${data.videoId}_task${i}_screenshot${j}`
            await imageStorage.storeImage(imageId, screenshot.image_base64)
          }
        }
      }
    }

    // Also try sessionStorage as backup (for non-Railway environments)
    try {
      sessionStorage.setItem('loomResults_videoId', data.videoId)
      console.log('[ImageStorage] Also stored videoId in sessionStorage')
    } catch (e) {
      console.warn('[ImageStorage] sessionStorage failed (quota), but IndexedDB succeeded')
    }

    console.log('[ImageStorage] ✅ Successfully stored all data in IndexedDB')
  } catch (error) {
    console.error('[ImageStorage] ❌ Failed to store in IndexedDB:', error)
    throw error
  }
}

/**
 * Helper function to retrieve processing results
 */
export async function getProcessingResults(): Promise<any | null> {
  try {
    // Try to get videoId from sessionStorage first
    let videoId = sessionStorage.getItem('loomResults_videoId')
    
    if (!videoId) {
      // Fallback: try old sessionStorage format
      const oldData = sessionStorage.getItem('loomResults')
      if (oldData) {
        const parsed = JSON.parse(oldData)
        videoId = parsed.videoId
      }
    }

    if (!videoId) {
      console.log('[ImageStorage] No videoId found')
      return null
    }

    console.log('[ImageStorage] Loading data for videoId:', videoId)

    // Get task data from IndexedDB
    const taskData = await imageStorage.getTaskData(videoId)
    if (!taskData) {
      console.log('[ImageStorage] No task data found in IndexedDB')
      return null
    }

    // Reconstruct tasks with base64 images
    const tasksWithImages = await Promise.all(
      taskData.tasks.map(async (task: any, i: number) => {
        // Get primary image
        const primaryImageId = `${videoId}_task${i}_primary`
        const primaryBase64 = await imageStorage.getImage(primaryImageId)

        // Get screenshot images
        const screenshots = task.screenshots
          ? await Promise.all(
              task.screenshots.map(async (screenshot: any, j: number) => {
                const screenshotImageId = `${videoId}_task${i}_screenshot${j}`
                const screenshotBase64 = await imageStorage.getImage(screenshotImageId)
                return {
                  ...screenshot,
                  image_base64: screenshotBase64 || undefined
                }
              })
            )
          : undefined

        return {
          ...task,
          image_base64: primaryBase64 || undefined,
          screenshots
        }
      })
    )

    console.log('[ImageStorage] ✅ Successfully loaded all data from IndexedDB')

    return {
      videoId,
      summary: taskData.summary || '',
      tasks: tasksWithImages,
      totalTasks: tasksWithImages.length
    }
  } catch (error) {
    console.error('[ImageStorage] ❌ Failed to retrieve from IndexedDB:', error)
    
    // Fallback to sessionStorage
    try {
      const oldData = sessionStorage.getItem('loomResults')
      if (oldData) {
        console.log('[ImageStorage] Falling back to sessionStorage')
        return JSON.parse(oldData)
      }
    } catch (e) {
      // Ignore
    }
    
    return null
  }
}
