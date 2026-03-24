/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.loom.com',
      },
    ],
    // Unoptimized for Railway/VPS deployments
    unoptimized: true,
  },
  // Ensure static file serving works for runtime-generated images
  async headers() {
    return [
      {
        source: '/temp/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
