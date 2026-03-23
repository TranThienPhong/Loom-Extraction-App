# 🚀 Quick Fix: Install Missing Dependencies

You're seeing errors because **yt-dlp** and **ffmpeg** are not installed on your system.

## Install Both Dependencies (2 minutes)

### Step 1: Install yt-dlp
```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

### Step 2: Install ffmpeg
```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

### Step 3: Verify Installation
```bash
yt-dlp --version
ffmpeg -version
```

You should see version numbers for both commands.

## Then Test the App Again

1. Make sure your dev server is running:
   ```bash
   npm run dev
   ```

2. Open http://localhost:3000

3. Try processing your Loom video again:
   - URL: `https://www.loom.com/share/12c2c12f20824cc2b05cc7d0bf90bbc9`
   - Check "Paste transcript manually"
   - Add a simple transcript like:
     ```
     0:05 - Test task one
     0:15 - Test task two
     ```
   - Click "Process Video"

## What I Fixed

1. ✅ **Hydration Error** - Fixed by adding `suppressHydrationWarning` (browser extension conflicts)
2. ✅ **Better Error Messages** - Now shows helpful install instructions when dependencies are missing
3. ✅ **Dependency Checks** - App checks for yt-dlp and ffmpeg before trying to use them
4. ✅ **Improved Error UI** - Prettier error display with installation commands

## If You Still Get Errors

Run the dependency checker:
```bash
./check-dependencies.sh
```

This will tell you exactly what's missing.
