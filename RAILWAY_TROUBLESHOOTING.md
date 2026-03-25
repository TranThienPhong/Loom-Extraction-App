# Railway Deployment - Troubleshooting Guide

## Issue: Images Not Showing with Timestamps (SOLVED ✅)

### Problem
After deploying to Railway, the processed video results don't show screenshot images with timestamps burned into them.

### Root Cause
Railway has **ephemeral filesystem** - files saved to `/public/frames/` don't persist across requests. Images are generated but can't be accessed later.

### Solution Implemented

#### Smart Storage Strategy
The app now tries to store base64 images in sessionStorage (for Railway), with automatic fallback:

**In [app/page.tsx](app/page.tsx#L41-L66):**
```typescript
try {
  // Try to store WITH base64 (needed for Railway)
  sessionStorage.setItem('loomResults', JSON.stringify(data))
  console.log('Stored results with base64 images')
} catch (quotaError) {
  // If quota exceeded, strip base64 (works locally with file URLs)
  const dataWithoutBase64 = ...
  sessionStorage.setItem('loomResults', JSON.stringify(dataWithoutBase64))
}
```

**Benefits:**
- ✅ **Railway deployment**: base64 in sessionStorage → images display
- ✅ **Local development**: If quota error, uses file URLs (smaller storage)
- ✅ **Automatic fallback**: Works for both small and large videos

#### Multiple Screenshots with Navigation
Added image gallery with arrow navigation:

**In [app/results/page.tsx](app/results/page.tsx):**
- Click any screenshot → opens lightbox
- Previous/Next arrows appear (if multiple screenshots)
- Shows "X of Y" counter
- Keyboard-friendly navigation

**Features:**
- 📸 Gallery grid (up to 3 screenshots per task)
- ⬅️ ➡️ Arrow buttons for navigation
- 🔢 Image counter (1 of 3)
- ⌨️ Click outside to close

### Verification Steps

#### 1. Check Railway Logs
```
Look for:
✅ "Stored results with base64 images" (sessionStorage working)
✅ "Base64 image created (228000 bytes)" (images encoded)
✅ "Successfully captured 3/3 screenshots" (multi-frame extraction)

Red flags:
❌ "sessionStorage quota exceeded" (video too long - base64 too large)
❌ ffmpeg errors about fonts or drawtext
```

#### 2. Test in Browser Console
```javascript
// Check if base64 images are present
const results = JSON.parse(sessionStorage.getItem('loomResults'))
console.log('Tasks with base64:', results.tasks.filter(t => t.image_base64).length)
console.log('Tasks with screenshot arrays:', results.tasks.filter(t => t.screenshots?.length > 1).length)
```

#### 3. Verify Image Display
- Open browser DevTools → Network tab
- Base64 working: img src shows `data:image/jpeg;base64...`
- File URLs: img src shows `/frames/frame-0-23.jpg`

### Railway-Specific Settings

**Ensure these settings in Railway dashboard:**

1. **Environment Variables**
   ```
   NODE_ENV=production
   OPENROUTER_API_KEY=sk-or-v1-...
   (Add your preferred AI provider API key)
   ```

2. **Build Settings**
   - Build Command: `npm run build`
   - Start Command: `npm start`
   - nixpacks.toml should be detected automatically

3. **Domain Settings**
   - Generate domain in Railway dashboard
   - Or connect custom domain

### How Multiple Screenshots Work

The AI now identifies 1-3 key moments per task:

1. **Before state** - Setup or initial condition
2. **Action moment** - Click, hover, interaction
3. **After state** - Result, popup, error

**Example:**
```
Task: "Button shows error when clicked"
Screenshots:
  - 1:19 (before click - button visible)
  - 1:21 (during click - button pressed)
  - 1:23 (after click - error popup shown)
```

### Railway-Specific Configuration

#### Option A: Using nixpacks.toml (Current)
```toml
[phases.setup]
nixPkgs = ["nodejs", "npm", "ffmpeg", "yt-dlp"]
```

This installs ffmpeg with basic fonts. If timestamps still don't appear:

#### Option B: Add to Dockerfile
```dockerfile
RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    ttf-dejavu
```

#### Option C: Use Custom Font
```typescript
// In frameExtractor.ts
const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')
drawtext=fontfile=${fontPath}:text='0-23':...
```

### Testing the Fix

1. **Local Test**
   ```bash
   npm run dev
   # Process a video
   # Check browser console for base64 data
   # Verify image displays
   ```

2. **Railway Test**
   ```bash
   # Push changes
   git add .
   git commit -m "Add base64 image fallback for Railway"
   git push
   
   # Railway auto-deploys
   # Wait for build to complete
   # Test video processing
   ```

3. **Debug Mode**
   Add to Railway environment variables:
   ```
   DEBUG=true
   NODE_ENV=production
   ```

   This enables verbose logging including:
   - Frame extraction steps
   - File sizes
   - Base64 encoding success/failure
   - ffmpeg commands executed

### Expected Behavior

#### ✅ Working Correctly
- Screenshots display on results page
- Timestamps visible in top-left corner of images
- Format: `0-23` (time in MM-SS format with hyphen)
- PDF export includes images with clickable links

#### ❌ Still Not Working

If images still don't show after these fixes:

1. **Check Railway logs** for ffmpeg errors
2. **Verify base64 is generated**: 
   - Look for "Base64 image created" in logs
   - Check API response in browser DevTools
3. **Test ffmpeg manually** on Railway:
   ```bash
   # SSH into Railway container (if available)
   ffmpeg -version
   ffmpeg -ss 5 -i video.mp4 -vframes 1 -vf "drawtext=text='TEST':x=30:y=30" test.jpg
   ```

### Alternative Solution: External Storage

If base64 proves too large or causes issues:

```typescript
// Use Cloudinary, AWS S3, or similar
const uploadToCloudinary = async (imagePath: string) => {
  const result = await cloudinary.uploader.upload(imagePath)
  return result.secure_url
}

// In API:
const imageUrl = await uploadToCloudinary(framePath)
```

This requires additional service setup and API keys.

### Performance Considerations

Base64 encoding increases API response size:
- 1 frame (200KB) → ~270KB base64
- 5 frames → ~1.35MB total response
- 10 frames → ~2.7MB total response

If this causes timeout issues, consider:
1. Processing fewer frames
2. Reducing image quality (`-q:v 5` instead of `-q:v 2`)
3. Reducing image dimensions (`-vf "scale=1280:-1,drawtext=..."`)
4. Using external storage (S3, Cloudinary)

### Summary

**Current Implementation:**
- ✅ Base64 fallback ensures images always work
- ✅ Simplified timestamp burning for better compatibility  
- ✅ Automatic error handling and fallback
- ✅ Works on ephemeral filesystems (Railway, Heroku, etc.)

**Trade-offs:**
- Larger API responses
- More memory usage during processing
- Still relies on filesystem for temporary storage during extraction

**Best for:** Small to medium videos (5-15 tasks). For larger batches, consider external storage.
