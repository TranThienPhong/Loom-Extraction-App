FROM node:20-alpine

# Install ffmpeg, curl, and python3 (required by yt-dlp)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    curl

# Install yt-dlp (latest release)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app files
COPY . .

# Build Next.js app
RUN npm run build

# Create runtime directories
RUN mkdir -p temp public/temp/frames

# Expose port (Railway overrides this with $PORT env var)
EXPOSE 3000

# Start the app — Railway injects PORT env var at runtime
CMD ["sh", "-c", "npm start -- -p ${PORT:-3000}"]
