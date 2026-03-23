# Loom Extraction App

A web application that automatically extracts actionable tasks from Loom video feedback with AI analysis, timestamps, and screenshot captures.

## Features

- 🎥 **Video Processing**: Downloads Loom videos for frame extraction
- 📝 **Transcript Analysis**: Uses Claude AI to identify tasks and change requests
- 📸 **Screenshot Capture**: Automatically captures frames at task timestamps
- ⏱️ **Timestamp Links**: Clickable links to exact moments in the Loom video
- 📄 **PDF Export**: Export all tasks as a PDF with hotlinked screenshots
- 🎨 **Clean UI**: Modern, responsive interface built with Tailwind CSS

## Prerequisites

Before running this application, you need to install the following system dependencies:

### 1. yt-dlp (for video downloading)

**Linux/Ubuntu:**
```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

**macOS:**
```bash
brew install yt-dlp
```

**Verify installation:**
```bash
yt-dlp --version
```

### 2. ffmpeg (for frame extraction)

**Linux/Ubuntu:**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

**Verify installation:**
```bash
ffmpeg -version
```

## Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd Loom-Extraction-App
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.local.example .env.local
   ```
   
   Edit `.env.local` and add your API keys:
   ```env
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   ```

   Get your Anthropic API key from: https://console.anthropic.com/

4. **Create required directories:**
   ```bash
   mkdir -p temp public/temp/frames
   ```

## Development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Method 1: Manual Transcript Input (Recommended for now)

1. Paste your Loom video URL
2. Check "Paste transcript manually"
3. Add your transcript in this format:
   ```
   0:05 - The header is misaligned on the home page
   0:15 - Button color should be blue instead of green
   0:23 - Add a loading spinner to the submit button
   ```
4. Click "Process Video"
5. Wait for AI analysis and screenshot extraction
6. View results and export as PDF

### Method 2: Automatic (Coming Soon)

Automatic transcript extraction via Loom API or Apify scraper will be added in a future update.

## Architecture

### Frontend (`/app`)
- **page.tsx**: Home page with URL input and manual transcript option
- **results/page.tsx**: Task display with cards showing screenshots and links
- Built with Next.js 14 App Router and Tailwind CSS

### Backend (`/app/api`)
- **process-loom/route.ts**: Main API endpoint handling the entire pipeline

### Utilities (`/lib`)
- **videoDownloader.ts**: Downloads Loom videos using yt-dlp
- **frameExtractor.ts**: Extracts video frames at specific timestamps using ffmpeg
- **transcriptParser.ts**: Parses manual transcripts and handles timestamps
- **aiAnalyzer.ts**: Analyzes transcripts with Claude AI to extract tasks

## API Endpoints

### POST `/api/process-loom`

Processes a Loom video and extracts tasks.

**Request Body:**
```json
{
  "loomUrl": "https://www.loom.com/share/abc123",
  "manualTranscript": "0:05 - Fix header\n0:15 - Change button color"
}
```

**Response:**
```json
{
  "success": true,
  "videoId": "abc123",
  "tasks": [
    {
      "timestamp_seconds": 5,
      "timestamp_label": "0:05",
      "task_name": "Fix header alignment",
      "task_description": "The header is misaligned...",
      "image_url": "/temp/frames/abc123_5s.jpg",
      "loom_url": "https://www.loom.com/share/abc123?t=5"
    }
  ],
  "totalTasks": 1
}
```

## Deployment

### ⚠️ IMPORTANT: Vercel Limitations

**This app requires system binaries (yt-dlp and ffmpeg) that are NOT available on Vercel's serverless platform.**

- ✅ The UI will deploy and display correctly
- ❌ Video processing features will NOT work
- ❌ API calls will fail without the required dependencies

**See [VERCEL_DEPLOYMENT_WARNING.md](VERCEL_DEPLOYMENT_WARNING.md) for detailed solutions and alternatives.**

**Recommended:** Deploy to a VPS, Railway.app, or Render.com where you can install system dependencies.

### Deploy to Vercel (UI Preview Only)

⚠️ **Use this only for testing the frontend UI.** Video processing will not work.

1. **Push your code to GitHub:**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Connect to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Add environment variables in Vercel dashboard:
     - `ANTHROPIC_API_KEY`

The build will succeed but the `/api/process-loom` endpoint will fail at runtime due to missing system dependencies.

### Deploy to VPS (Fully Functional - Recommended)

For full control over system dependencies (yt-dlp, ffmpeg):

1. Set up a VPS (DigitalOcean, AWS EC2, etc.)
2. Install Node.js, yt-dlp, and ffmpeg
3. Clone repository and install dependencies
4. Use PM2 for process management:
   ```bash
   npm install -g pm2
   pm2 start npm --name "loom-app" -- start
   ```
5. Set up Nginx as reverse proxy
6. Configure SSL with Let's Encrypt

## Troubleshooting

### "yt-dlp: command not found"
Make sure yt-dlp is installed and in your PATH. Run `which yt-dlp` to verify.

### "ffmpeg: command not found"
Make sure ffmpeg is installed. Run `which ffmpeg` to verify.

### "ANTHROPIC_API_KEY environment variable is not set"
Create a `.env.local` file with your API key as shown in the installation steps.

### "Failed to download video"
- Ensure the Loom video is public (not private)
- Check your internet connection
- Verify yt-dlp is up to date: `yt-dlp --update`

### "Frame extraction failed"
- Verify ffmpeg is installed correctly
- Check that the video file exists in the `temp/` directory
- Ensure timestamps are within the video duration

## Future Enhancements

- [ ] Automatic transcript extraction via Apify
- [ ] Support for SRT file upload
- [ ] Batch processing multiple videos
- [ ] Progress indicators during processing
- [ ] Task editing and filtering
- [ ] Export to other formats (CSV, JSON, Markdown)
- [ ] Integration with project management tools (Jira, Linear, etc.)

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **AI**: Claude (Anthropic)
- **PDF**: jsPDF
- **Video Processing**: yt-dlp, ffmpeg

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
