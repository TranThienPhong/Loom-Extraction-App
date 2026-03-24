# Railway Deployment - Troubleshooting Guide

## Issue: Images Not Showing with Timestamps

### Problem
After deploying to Railway, the processed video results don't show screenshot images with timestamps burned into them.

### Possible Causes

1. **Ephemeral Filesystem**
   - Railway containers may have ephemeral storage
   - Files created at runtime (in `public/temp/`) may not persist or be accessible

2. **ffmpeg Font Issues**
   - Alpine Linux (used in Docker/Railway) may not have required fonts
   - The `drawtext` filter may fail silently without fonts

3. **Static File Serving**
   - Runtime-generated files in `public/` may not be served correctly in production

### Solutions Implemented

#### 1. Base64 Encoding (Primary Solution)
The API now includes images as base64-encoded data URLs in the response:

```typescript
// In app/api/process-loom/route.ts
image_base64: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
```

**Advantages:**
- ✅ No filesystem dependencies
- ✅ Works on any platform
- ✅ Images embedded directly in API response
- ✅ No static file serving issues

**Disadvantages:**
- ⚠️ Larger API response size
- ⚠️ More memory usage

#### 2. Improved ffmpeg Command
Simplified timestamp burning with better compatibility:

```bash
# Old (complex escaping):
drawtext=text='⏱ 0\\:23':fontcolor=white...

# New (simple, no special chars):
drawtext=text='0-23':fontcolor=white:fontsize=40...
```

Changes:
- Removed emoji (may not render on all systems)
- Simplified timestamp format (`:` → `-`)
- Increased font size for visibility (32 → 40)
- Increased box opacity (0.7 → 0.8)

#### 3. Image Fallback System
The results page uses base64 as fallback:

```typescript
// Try regular URL first, fallback to base64 on error
<img
  src={imageErrors[index] && task.image_base64 ? task.image_base64 : task.image_url}
  onError={() => setImageErrors({ ...prev, [index]: true })}
/>
```

### Verification Steps

After deploying to Railway:

1. **Check Railway Logs**
   ```
   Look for:
   ✅ "Frame extracted successfully: /path/to/frame.jpg"
   ✅ "Frame file size: 228000 bytes"
   ✅ "Base64 image created (228000 bytes)"
   
   Red flags:
   ❌ "Frame file was created but is empty"
   ❌ "Failed to create base64 image"
   ❌ ffmpeg errors about fonts or drawtext
   ```

2. **Test in Browser Console**
   ```javascript
   // Check if base64 images are present
   const tasks = JSON.parse(sessionStorage.getItem('loomResults')).tasks
   console.log('Images with base64:', tasks.filter(t => t.image_base64).length)
   console.log('Total tasks:', tasks.length)
   ```

3. **Verify Image Display**
   - Open browser DevTools → Network tab
   - Check if images return 404 (file not found)
   - If base64 is working, you'll see `data:image/jpeg;base64...` in img src

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
