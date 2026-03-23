# Quick Start Guide

## ✅ What's Already Done

Your Loom Extraction App is now set up with:
- ✅ Next.js 15 with TypeScript and Tailwind CSS
- ✅ Three main views: Home, Loading (inline), Results
- ✅ Server-side video download utility (yt-dlp)
- ✅ Frame extraction utility (ffmpeg)
- ✅ AI analysis with Claude (Anthropic)
- ✅ PDF export functionality
- ✅ Task card UI with timestamp overlays
- ✅ npm dependencies installed

## 🔧 What You Need to Do

### 1. Install System Dependencies (Required)

You need two command-line tools installed on your system:

#### Install yt-dlp (for video downloading)
```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

#### Install ffmpeg (for frame extraction)
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**Verify installations:**
```bash
yt-dlp --version
ffmpeg -version
```

### 2. Configure API Key (Required)

Edit `.env.local` and add your Anthropic API key:

```bash
# Open the file
nano .env.local

# Or use your preferred editor
code .env.local
```

Replace `your_api_key_here` with your actual API key from:
https://console.anthropic.com/

### 3. Run the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 📝 How to Use

### Current Method (Manual Transcript + Video)

1. **Get your Loom video URL** (must be publicly accessible)
   ```
   https://www.loom.com/share/abc123def456
   ```

2. **Prepare your transcript** (see TRANSCRIPT_TEMPLATE.md)
   - Download SRT captions from Loom video (via "..." menu)
   - Format as: `0:05 - Description of task`
   - One task per line with timestamps

3. **Process the video:**
   - Paste Loom URL in the input field
   - Check "Paste transcript manually"
   - Paste your formatted transcript
   - Click "Process Video"

4. **Wait for processing:**
   - Video downloads (~30-60 seconds)
   - AI analyzes transcript (~10-20 seconds)
   - Frames extract (~5-10 seconds per task)

5. **View and export:**
   - Browse task cards with screenshots
   - Click "Watch in Loom" links
   - Export as PDF with hotlinked images

## 🎯 Example Workflow

Let's say you have a Loom video where you review a website and mention:
- At 0:15: "The header is misaligned"
- At 0:45: "Button should be blue not green"
- At 1:10: "Footer links are broken"

**Your transcript input:**
```
0:15 - The header is misaligned on the home page
0:45 - Button color should be blue instead of green
1:10 - Footer links are broken and need to be fixed
```

**What happens:**
1. App downloads the video
2. Claude AI identifies 3 distinct tasks
3. App extracts 3 screenshots at 15s, 45s, and 70s
4. Timestamps are overlaid on each image
5. You get a results page with clickable cards
6. Export as PDF for your team

## 🚀 Deployment

### Option 1: Test Locally First
```bash
npm run build
npm start
```

### Option 2: Deploy to Vercel (Limited)
⚠️ **Note:** Vercel's serverless functions may not support yt-dlp and ffmpeg. Consider VPS deployment for production.

```bash
git add .
git commit -m "Loom Extraction App ready"
git push origin main
```

Then connect your repo to Vercel and add environment variables.

### Option 3: Deploy to VPS (Recommended for Production)

**DigitalOcean, AWS EC2, or similar:**

1. SSH into your server
2. Install Node.js, yt-dlp, and ffmpeg
3. Clone your repository
4. Install dependencies: `npm install`
5. Set environment variables
6. Build: `npm run build`
7. Run with PM2: `pm2 start npm --name loom-app -- start`
8. Configure Nginx as reverse proxy
9. Set up SSL with Let's Encrypt

## 📊 File Structure

```
Loom-Extraction-App/
├── app/
│   ├── api/
│   │   └── process-loom/
│   │       └── route.ts        # Main API endpoint
│   ├── results/
│   │   └── page.tsx            # Results display page
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Home page
│   └── globals.css             # Global styles
├── lib/
│   ├── videoDownloader.ts      # yt-dlp wrapper
│   ├── frameExtractor.ts       # ffmpeg wrapper
│   ├── transcriptParser.ts     # Transcript formatting
│   └── aiAnalyzer.ts           # Claude AI integration
├── temp/                       # Downloaded videos (gitignored)
├── public/
│   └── temp/
│       └── frames/             # Extracted screenshots
├── .env.local                  # Your API keys (not in git)
├── check-dependencies.sh       # Dependency checker script
├── TRANSCRIPT_TEMPLATE.md      # Example transcript format
└── README.md                   # Full documentation
```

## 🔍 Troubleshooting

**"yt-dlp: command not found"**
- Run: `which yt-dlp` to check if installed
- Make sure it's in your PATH
- Try reinstalling with the commands above

**"ffmpeg: command not found"**
- Run: `which ffmpeg` to check if installed
- Install with: `sudo apt-get install ffmpeg`

**"Failed to download video"**
- Ensure the Loom video is **public** (not private)
- Check your internet connection
- Try the Loom URL in a browser first

**"AI analysis failed"**
- Check that ANTHROPIC_API_KEY is set in `.env.local`
- Verify your API key is valid at console.anthropic.com
- Check if you have API credits remaining

**"No tasks found"**
- Make sure your transcript mentions actual tasks/changes
- Be specific: "Fix the header" not just "header"
- Include timestamps in correct format (M:SS)

## 🎓 Advanced Tips

1. **Batch Processing**: Create multiple transcript files and process them one by one

2. **Better Descriptions**: The more detail in your Loom narration, the better task descriptions AI will generate

3. **Timestamping**: Be precise with timestamps - the screenshot will be from that exact second

4. **Cleanup**: Periodically delete old files in `temp/` and `public/temp/frames/` to save space

5. **API Costs**: Claude API calls cost money. Each video typically costs $0.01-0.10 depending on transcript length

## 📫 Next Steps

Once you've tested locally:
1. Share your Vercel deployment URL with Jaunius
2. Process a real Loom video to demonstrate
3. Gather feedback on task extraction quality
4. Consider adding automatic transcript extraction (future phase)

## 🆘 Need Help?

Check the full [README.md](README.md) for detailed documentation.

Run the dependency checker anytime:
```bash
./check-dependencies.sh
```
