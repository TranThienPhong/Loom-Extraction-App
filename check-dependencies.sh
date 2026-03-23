#!/bin/bash

echo "🚀 Loom Extraction App - Dependency Checker"
echo "==========================================="
echo ""

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js is installed: $NODE_VERSION"
else
    echo "❌ Node.js is NOT installed"
    echo "   Install from: https://nodejs.org/"
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✅ npm is installed: $NPM_VERSION"
else
    echo "❌ npm is NOT installed"
fi

# Check yt-dlp
if command -v yt-dlp &> /dev/null; then
    YTDLP_VERSION=$(yt-dlp --version)
    echo "✅ yt-dlp is installed: $YTDLP_VERSION"
else
    echo "❌ yt-dlp is NOT installed"
    echo "   Install with:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "   brew install yt-dlp"
    else
        echo "   sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp"
        echo "   sudo chmod a+rx /usr/local/bin/yt-dlp"
    fi
fi

# Check ffmpeg
if command -v ffmpeg &> /dev/null; then
    FFMPEG_VERSION=$(ffmpeg -version | head -n1)
    echo "✅ ffmpeg is installed: $FFMPEG_VERSION"
else
    echo "❌ ffmpeg is NOT installed"
    echo "   Install with:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "   brew install ffmpeg"
    else
        echo "   sudo apt-get update && sudo apt-get install ffmpeg"
    fi
fi

echo ""
echo "==========================================="

# Check if .env.local exists
if [ -f ".env.local" ]; then
    echo "✅ .env.local file exists"
    if grep -q "ANTHROPIC_API_KEY=your_api_key_here" .env.local || ! grep -q "ANTHROPIC_API_KEY=" .env.local; then
        echo "⚠️  WARNING: ANTHROPIC_API_KEY may not be configured"
        echo "   Edit .env.local and add your API key"
    else
        echo "✅ ANTHROPIC_API_KEY appears to be set"
    fi
else
    echo "⚠️  .env.local file not found"
    echo "   Run: cp .env.local.example .env.local"
    echo "   Then edit .env.local with your API key"
fi

# Check if node_modules exists
if [ -d "node_modules" ]; then
    echo "✅ Dependencies installed (node_modules exists)"
else
    echo "❌ Dependencies not installed"
    echo "   Run: npm install"
fi

# Check/create required directories
mkdir -p temp public/temp/frames
echo "✅ Required directories created"

echo ""
echo "==========================================="
echo "Setup Status:"
ALL_GOOD=true

if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    ALL_GOOD=false
fi
if ! command -v yt-dlp &> /dev/null; then
    ALL_GOOD=false
fi
if ! command -v ffmpeg &> /dev/null; then
    ALL_GOOD=false
fi
if [ ! -f ".env.local" ]; then
    ALL_GOOD=false
fi
if [ ! -d "node_modules" ]; then
    ALL_GOOD=false
fi

if [ "$ALL_GOOD" = true ]; then
    echo "🎉 All dependencies are installed and configured!"
    echo ""
    echo "To start the development server, run:"
    echo "   npm run dev"
else
    echo "⚠️  Some dependencies are missing. Please install them and try again."
fi

echo ""
