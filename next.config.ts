import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Webflow Cloud mounts this app at /dashboard on tahi.studio
  // basePath makes Next.js prepend /dashboard to all routes, links, and API calls transparently.
  // In code, always write href="/" or fetch('/api/...') — Next.js adds /dashboard automatically.
  basePath: '/dashboard',
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
