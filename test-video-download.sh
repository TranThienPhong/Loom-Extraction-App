#!/bin/bash

# Test script to verify yt-dlp can download a Loom video
# Usage: ./test-video-download.sh "https://www.loom.com/share/YOUR_VIDEO_ID"

echo "🧪 Testing Loom Video Download"
echo "==============================="
echo ""

if [ -z "$1" ]; then
    echo "❌ Error: Please provide a Loom video URL"
    echo ""
    echo "Usage:"
    echo "  ./test-video-download.sh \"https://www.loom.com/share/abc123\""
    echo ""
    exit 1
fi

LOOM_URL="$1"
VIDEO_ID=$(echo "$LOOM_URL" | grep -oP 'loom\.com/share/\K[a-zA-Z0-9]+')

if [ -z "$VIDEO_ID" ]; then
    echo "❌ Error: Invalid Loom URL format"
    echo "   Expected format: https://www.loom.com/share/VIDEO_ID"
    exit 1
fi

echo "📹 Video ID: $VIDEO_ID"
echo "🔗 URL: $LOOM_URL"
echo ""

# Check if yt-dlp is installed
if ! command -v yt-dlp &> /dev/null; then
    echo "❌ yt-dlp is not installed"
    echo ""
    echo "Install with:"
    echo "  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp"
    echo "  sudo chmod a+rx /usr/local/bin/yt-dlp"
    exit 1
fi

echo "✅ yt-dlp found: $(yt-dlp --version)"
echo ""

# Create temp directory
mkdir -p temp
OUTPUT_FILE="temp/test_${VIDEO_ID}.mp4"

echo "⏬ Starting download..."
echo "   Output: $OUTPUT_FILE"
echo ""

# Download video
yt-dlp -f "best[ext=mp4]" -o "$OUTPUT_FILE" "$LOOM_URL"

if [ $? -eq 0 ]; then
    if [ -f "$OUTPUT_FILE" ]; then
        FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
        echo ""
        echo "✅ Download successful!"
        echo "   File: $OUTPUT_FILE"
        echo "   Size: $FILE_SIZE"
        echo ""
        
        # Test frame extraction if ffmpeg is available
        if command -v ffmpeg &> /dev/null; then
            echo "🎬 Testing frame extraction at 5 seconds..."
            mkdir -p public/temp/frames
            FRAME_FILE="public/temp/frames/test_${VIDEO_ID}_5s.jpg"
            
            ffmpeg -ss 5 -i "$OUTPUT_FILE" -vframes 1 -q:v 2 "$FRAME_FILE" -y 2>&1 | grep -v "frame="
            
            if [ -f "$FRAME_FILE" ]; then
                FRAME_SIZE=$(du -h "$FRAME_FILE" | cut -f1)
                echo "✅ Frame extraction successful!"
                echo "   Frame: $FRAME_FILE"
                echo "   Size: $FRAME_SIZE"
                echo ""
                echo "🎉 All systems working! Your setup is ready."
            else
                echo "❌ Frame extraction failed"
            fi
        else
            echo "⚠️  ffmpeg not found - install it to test frame extraction"
        fi
        
        echo ""
        echo "🧹 Cleanup:"
        echo "   To delete test files, run:"
        echo "   rm $OUTPUT_FILE"
        echo "   rm $FRAME_FILE"
    else
        echo "❌ Download failed: File not created"
        exit 1
    fi
else
    echo "❌ Download failed"
    echo ""
    echo "Possible reasons:"
    echo "  - Video is private (not public)"
    echo "  - Invalid URL"
    echo "  - Network connection issue"
    echo "  - yt-dlp needs an update (run: yt-dlp --update)"
    exit 1
fi
