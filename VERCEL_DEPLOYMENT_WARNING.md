# ⚠️ IMPORTANT: Vercel Deployment Limitations

## System Dependencies Required

This application requires the following system binaries:
- **yt-dlp** - For downloading Loom videos
- **ffmpeg** - For extracting video frames

## ❌ Vercel Serverless Limitations

Vercel's serverless functions **DO NOT** include:
- yt-dlp
- ffmpeg

**The video processing features will NOT work on Vercel** without modifications.

## ✅ Solutions

### Option 1: Frontend-Only Deployment (Recommended for Vercel)
Deploy just the UI to Vercel and run the API separately on a VPS with the required dependencies.

### Option 2: Use Vercel Edge Functions with External API
- Deploy the Next.js frontend to Vercel
- Create a separate API service on a VPS/AWS/DigitalOcean with yt-dlp and ffmpeg
- Point the frontend to call your external API

### Option 3: Deploy Everything to a VPS (Fully Functional)
**Recommended for production:**
- DigitalOcean Droplet ($6/month)
- AWS EC2
- Google Cloud Compute Engine
- Any VPS with full system access

Install dependencies:
```bash
# On Ubuntu/Debian
sudo apt-get update
sudo apt-get install ffmpeg
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

### Option 4: Workaround with FFmpeg Layer (Advanced)
Some users have success using:
- `@ffmpeg-installer/ffmpeg` npm package
- Custom build process to include binaries
- Docker containers on Vercel (experimental)

## 🎯 Current Deployment Status

If you deploy to Vercel now:
- ✅ Frontend will work (home page, UI)
- ❌ Video processing API will fail
- ❌ Frame extraction will not work

## 📝 Recommendation

**For testing the UI:** Deploy to Vercel (it will work for visual review)

**For production use:** Deploy to a VPS where you can install system dependencies

## 🔧 VPS Deployment Quick Guide

```bash
# 1. SSH into your VPS
ssh user@your-server-ip

# 2. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install dependencies
sudo apt-get install ffmpeg
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# 4. Clone and deploy
git clone https://github.com/YOUR_USERNAME/Loom-Extraction-App.git
cd Loom-Extraction-App
npm install
npm run build

# 5. Run with PM2
npm install -g pm2
pm2 start npm --name "loom-app" -- start
pm2 startup
pm2 save

# 6. Set up Nginx reverse proxy (optional)
sudo apt install nginx
# Configure nginx to proxy to localhost:3000
```

## 🌐 Alternative: Railway.app or Render.com

These platforms support Docker and custom build steps:
- Railway.app - Supports custom Dockerfile
- Render.com - Supports custom build commands
- Both allow apt-get install during build

Example `Dockerfile`:
```dockerfile
FROM node:20
RUN apt-get update && apt-get install -y ffmpeg
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
CMD ["npm", "start"]
```
