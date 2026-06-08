/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep these out of the server bundle so they load from node_modules at
  // runtime. pdf-lib does deep CommonJS requires into its own internals
  // (cjs/core/streams/*) and pdfjs-dist loads .mjs worker files — bundling
  // breaks both, which silently produced ZERO extracted PDF images on Railway
  // (works locally because dev/tsx read straight from node_modules).
  // 'sharp' is a native module (used to downscale extracted PDF screenshots);
  // keep it external so its prebuilt binary loads from node_modules at runtime.
  serverExternalPackages: ['pg', 'pdf-lib', 'pdfjs-dist', 'sharp'],
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
