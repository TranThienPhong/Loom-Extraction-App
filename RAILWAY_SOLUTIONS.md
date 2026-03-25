# Railway Image Issues - Complete Analysis & Solutions

## 🔴 Why Previous Solutions FAILED

### Attempt 1: Base64 in sessionStorage ❌
**What we tried:**
```typescript
sessionStorage.setItem('loomResults', JSON.stringify(data)) // data includes base64
```

**Why it failed:**
- sessionStorage has **5-10MB quota** limit
- Each screenshot is ~185KB base64
- With 24 screenshots: 185KB × 24 = **4.4MB** just for images
- Plus JSON overhead = **~5-6MB total**
- **EXCEEDED QUOTA** → throws QuotaExceededError
- Even with try/catch, if it fails, we stripped base64
- Result: Railway got NO images

### Attempt 2: Smart try/catch fallback ❌
**What we tried:**
```typescript
try {
  sessionStorage.setItem('loomResults', JSON.stringify(data)) // with base64
} catch {
  sessionStorage.setItem('loomResults', JSON.stringify(dataWithoutBase64)) // without base64
}
```

**Why it failed:**
- Catch block removes base64 on quota error
- Railway ephemeral filesystem = file URLs don't work
- So Railway deployment gets: ❌ No base64, ❌ File URLs broken
- Result: **NO IMAGES AT ALL**

### Attempt 3: Base64 fallback in `<img>` ❌
**What we tried:**
```typescript
<img src={task.image_base64 || task.image_url} />
```

**Why it failed:**
- `Task.image_base64` was **undefined** (because sessionStorage quota failed)
- Falls back to `task.image_url` = `/frames/video_123s.jpg`
- But Railway has ephemeral filesystem
- File exists during API call, but **disappears after container restart**
- Result: 404 errors, broken images

## ✅ NEW SOLUTIONS (Multiple Approaches)

### Solution 1: IndexedDB Storage (PRIMARY) ✅

**How it works:**
1. Uses browser's IndexedDB instead of sessionStorage
2. **50MB+ quota** (10x larger than sessionStorage)
3. Stores task data and images separately
4. Works offline after first load

**Implementation:**
- `lib/imageStorage.ts` - IndexedDB manager
- `app/page.tsx` - Calls `storeProcessingResults(data)`
- `app/results/page.tsx` - Calls `getProcessingResults()`

**Advantages:**
- ✅ **Much larger quota** (50MB+ vs 5-10MB)
- ✅ **Works on Railway** (no filesystem dependency)
- ✅ **Persists across sessions** (survives browser reload)
- ✅ **Automatic cleanup** (clears old data after 24hrs)

**Code Flow:**
```typescript
// Storing (app/page.tsx)
await storeProcessingResults(data) // Stores in IndexedDB

// Retrieving (app/results/page.tsx)
const data = await getProcessingResults() // Loads from IndexedDB
setTasks(data.tasks) // Tasks have base64 images attached
```

### Solution 2: Image Cache API Endpoint ✅

**How it works:**
1. Server keeps images in memory cache (30min TTL)
2. Frontend requests: `/api/get-image?path=/frames/video_123s.jpg`
3. API returns base64 on-demand
4. Fallback if IndexedDB quota also fails

**Implementation:**
```typescript
// Frontend (if IndexedDB fails)
const response = await fetch(`/api/get-image?path=${imagePath}`)
const { base64 } = await response.json()
setImage(base64)
```

**Advantages:**
- ✅ **No browser storage** needed
- ✅ **Works with any video length**
- ✅ **Server-side caching** (fast subsequent loads)
- ✅ **Automatic cleanup** (expires after 30min)

### Solution 3: Railway Volumes (INFRASTRUCTURE) ✅

**How it works:**
1. Mount persistent disk at `/app/public/temp`
2. Images saved there persist across deploys
3. File URLs work normally
4. No encoding needed

**Setup:**
See `RAILWAY_VOLUMES.md` for full instructions

**Advantages:**
- ✅ **True persistence** (survives deploys/restarts)
- ✅ **No encoding overhead** (serve raw files)
- ✅ **Better performance** (no base64 conversion)
- ✅ **Scalable** (works with CDN in future)

**Disadvantages:**
- ⚠️ **Cost** (~$0.25/GB/month)
- ⚠️ **Per-replica** (not shared across instances)

### Solution 4: Keyboard Navigation ✅

**What we added:**
```typescript
useEffect(() => {
  const handleKeyPress = (e: KeyboardEvent) => {
    if (lightboxImage) {
      if (e.key === 'ArrowLeft') showPreviousImage()
      if (e.key === 'ArrowRight') showNextImage()
      if (e.key === 'Escape') setLightboxImage(null)
    }
  }
  window.addEventListener('keydown', handleKeyPress)
  return () => window.removeEventListener('keydown', handleKeyPress)
}, [lightboxImage, lightboxIndex, currentTaskScreenshots])
```

**Features:**
- ⬅️ Left arrow = previous image
- ➡️ Right arrow = next image
- Esc = close lightbox
- Works alongside click navigation

## 🎯 Recommended Deployment Strategy

### Quick Fix (No Infrastructure Changes)
1. ✅ Use IndexedDB (already implemented)
2. ✅ Deploy to Railway
3. ✅ Test with a Loom video
4. Images should now appear!

### Production Setup (Best Performance)
1. ✅ Add Railway Volume (see RAILWAY_VOLUMES.md)
2. ✅ Keep IndexedDB as frontend cache
3. ✅ Use Image Cache API as fallback
4. Result: Triple redundancy!

## 🧪 Testing Checklist

### Local Development
- [ ] Process a Loom video
- [ ] Check browser console for "[ImageStorage] ✅"
- [ ] Open DevTools → Application → IndexedDB → loomExtractorDB
- [ ] Verify images stored
- [ ] Reload page - images should persist
- [ ] Press ⬅️ ➡️ arrows - images should change

### Railway Deployment
- [ ] Deploy to Railway
- [ ] Process a Loom video
- [ ] Check logs for "[ImageStorage] ✅ Successfully stored"
- [ ] Verify images display with timestamps
- [ ] Reload page - images should still show (IndexedDB)
- [ ] Test keyboard navigation

### With Railway Volumes (Optional)
- [ ] Add volume at /app/public/temp
- [ ] Redeploy
- [ ] Process video
- [ ] Check logs - should see file paths instead of base64
- [ ] Images should load via URLs (not base64)

## 📊 Comparison Table

| Solution | Storage | Quota | Persists? | Railway? | Cost |
|----------|---------|-------|-----------|----------|------|
| sessionStorage | Browser | 5-10MB | ❌ No | ❌ Fails | Free |
| IndexedDB | Browser | 50MB+ | ✅ Yes | ✅ Yes | Free |
| Image API | Server RAM | Unlimited* | ⏱️ 30min | ✅ Yes | Free |
| Railway Volumes | Disk | 1GB+ | ✅ Yes | ✅ Yes | $0.25/GB/mo |

\* Limited by server memory

## 🔍 Debugging Commands

### Check IndexedDB Contents
```javascript
// In browser console
const request = indexedDB.open('loomExtractorDB', 1)
request.onsuccess = (e) => {
  const db = e.target.result
  const tx = db.transaction(['tasks'], 'readonly')
  const store = tx.objectStore('tasks')
  const getAll = store.getAll()
  getAll.onsuccess = () => console.log('Tasks:', getAll.result)
}
```

### Check sessionStorage Quota
```javascript
// See what's stored
Object.keys(sessionStorage).forEach(key => {
  const size = new Blob([sessionStorage.getItem(key)]).size
  console.log(`${key}: ${(size / 1024).toFixed(2)} KB`)
})
```

### API Image Fetch Test
```javascript
// Test image API endpoint
fetch('/api/get-image?path=/temp/frames/video_123s.jpg')
  .then(r => r.json())
  .then(data => console.log('Base64 length:', data.base64.length))
```

## 🚀 Next Steps

1. **Testing**: Test locally with a long video (10+ tasks, 24+ screenshots)
2. **Deploy**: Push to Railway and verify images appear
3. **Monitor**: Check Railway logs for "[ImageStorage]" messages
4. **Optimize**: If still issues, add Railway Volume
5. **Scale**: For high traffic, consider CDN (Cloudinary, etc.)

## ❓ FAQ

**Q: Will IndexedDB work on all browsers?**
A: Yes, supported by all modern browsers (Chrome, Firefox, Safari, Edge)

**Q: What if IndexedDB quota also fails?**
A: Falls back to Image Cache API endpoint (server-side storage)

**Q: Do I need Railway Volumes?**
A: No, but recommended for production (better performance, lower bandwidth)

**Q: Will this work with sessionStorage disabled?**
A: Yes, IndexedDB works independently

**Q: How long do images stay cached?**
A: IndexedDB: 24 hours, Image API: 30 minutes, Railway Volumes: Forever
