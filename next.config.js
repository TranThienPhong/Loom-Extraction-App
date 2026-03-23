/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.loom.com',
      },
    ],
  },
}

module.exports = nextConfig
