FROM node:20-alpine

# Install ffmpeg + python3/pip (yt-dlp is a Python application)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    curl

# Install yt-dlp from PyPI rather than curling the GitHub "latest" release binary.
# That old approach (`curl -L .../yt-dlp -o /usr/local/bin/yt-dlp`) intermittently
# saved a GitHub HTML/redirect page instead of the real binary; once chmod'd it
# failed at RUNTIME with "yt-dlp: line 1: syntax error: unexpected redirection"
# (sh parsing the HTML's leading '<'). pip installs a proper console script with a
# correct shebang, and `yt-dlp --version` verifies it here so a broken install
# fails the BUILD loudly instead of every Loom request.
RUN (pip3 install --no-cache-dir --break-system-packages yt-dlp \
     || pip3 install --no-cache-dir yt-dlp) \
    && yt-dlp --version

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
