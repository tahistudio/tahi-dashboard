import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const nextConfig: NextConfig = {
  // The app serves at the domain root (e.g. portal.tahi.studio). No basePath.

  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'date-fns',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
    ],
  },

  // ─── NEXT_PUBLIC_* vars ─────────────────────────────────────────────────────
  // Webflow Cloud only injects env vars at RUNTIME, but Next.js NEXT_PUBLIC_* vars
  // must be baked in at BUILD time. We inline the public (non-secret) values here.
  // These are all safe to be in the codebase : they are publishable/public keys.
  // Secret keys (STRIPE_SECRET_KEY, CLERK_SECRET_KEY, etc.) stay as runtime env vars.
  env: {
    // Clerk : publishable key is intentionally public
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
      'pk_test_ZW5qb3llZC1nbGlkZXItNTguY2xlcmsuYWNjb3VudHMuZGV2JA',

    // Clerk redirect URLs : app-root-relative (no basePath).
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
    // Clerk v5+ fallback redirect URLs (replaces deprecated afterSignInUrl / afterSignUpUrl)
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/overview',
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/overview',
    // After sign-out go to sign-in
    NEXT_PUBLIC_CLERK_SIGN_OUT_URL: '/sign-in',

    // The Tahi Studio org ID : determines who sees the admin view
    NEXT_PUBLIC_TAHI_ORG_ID:
      process.env.NEXT_PUBLIC_TAHI_ORG_ID ?? 'org_3BTHLj5IhFDy8DnaI2ytVbt4WrG',

    // Stripe : publishable key is intentionally public
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
      'pk_test_51TF61F2MOtshRPkAvZyS5RiWaYJm6wAkfYXCUSsN79JN0TbG2WzfNVFQmVdKnMtBdx0yZo1lGLopXDCQWrrCAyHQ00vLIsERvm',

    // Loom : app ID is public (used in the embed SDK)
    NEXT_PUBLIC_LOOM_APP_ID:
      process.env.NEXT_PUBLIC_LOOM_APP_ID ?? '71cf0991-7ce1-4a0b-a964-57957d84d22f',

    // App URL : root origin of the live dashboard (no basePath)
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ?? 'https://portal.tahi.studio',

    // BasePath : empty (app served at domain root). apiPath() resolves to a
    // plain passthrough, so existing client fetch calls keep working unchanged.
    NEXT_PUBLIC_BASEPATH: '',
  },

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

  // Permanent redirects for renamed routes. Old bookmarks land on the
  // new page without breaking. Add new entries here when renaming.
  async redirects() {
    return [
      { source: '/pipeline',         destination: '/deals',         permanent: true },
      { source: '/pipeline/:path*',  destination: '/deals/:path*',  permanent: true },
    ]
  },
}

export default nextConfig

// Wire Cloudflare bindings (D1 `DB`, R2 `STORAGE`) into `next dev` so local
// development can actually reach the database. This is a no-op in production
// builds. Without it, getCloudflareContext() has no bindings and every db()
// call throws, which is why local dev shows empty data.
initOpenNextCloudflareForDev()
