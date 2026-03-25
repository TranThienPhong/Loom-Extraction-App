import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

/**
 * API endpoint to serve cached images
 * This is a fallback for Railway deployment when file URLs don't work
 * 
 * Usage: GET /api/get-image?path=/temp/frames/video_123s.jpg
 */

// In-memory cache for images (survives across requests in the same container instance)
const imageCache = new Map<string, { base64: string; timestamp: number }>()
const CACHE_DURATION = 30 * 60 * 1000 // 30 minutes

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const imagePath = searchParams.get('path')

    if (!imagePath) {
      return NextResponse.json(
        { error: 'Image path is required' },
        { status: 400 }
      )
    }

    // Check cache first
    const cached = imageCache.get(imagePath)
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`[ImageAPI] ✅ Serving from cache: ${imagePath}`)
      return NextResponse.json({ base64: cached.base64 })
    }

    // Try to read from filesystem
    const fullPath = path.join(process.cwd(), 'public', imagePath)
    
    if (!fs.existsSync(fullPath)) {
      console.log(`[ImageAPI] ❌ Image not found: ${fullPath}`)
      return NextResponse.json(
        { error: 'Image not found' },
        { status: 404 }
      )
    }

    const imageBuffer = fs.readFileSync(fullPath)
    const base64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`

    // Store in cache
    imageCache.set(imagePath, { base64, timestamp: Date.now() })
    console.log(`[ImageAPI] ✅ Served from filesystem and cached: ${imagePath}`)

    // Clean old cache entries
    cleanCache()

    return NextResponse.json({ base64 })
  } catch (error: any) {
    console.error('[ImageAPI] ❌ Error serving image:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to serve image' },
      { status: 500 }
    )
  }
}

function cleanCache() {
  const now = Date.now()
  const entries = Array.from(imageCache.entries())
  for (const [key, value] of entries) {
    if (now - value.timestamp > CACHE_DURATION) {
      imageCache.delete(key)
    }
  }
}
