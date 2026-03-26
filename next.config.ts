import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Webflow Cloud (Cloudflare Workers) output
  // Use 'standalone' for edge deployment compatibility
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.dev',
      },
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
    ],
  },
}

export default nextConfig
