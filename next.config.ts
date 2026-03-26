import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Webflow Cloud mounts this app at /dashboard on tahi.studio
  // basePath makes Next.js prepend /dashboard to all internal routes, links, and API calls.
  // In code, always write href="/" or fetch('/api/...') — Next.js adds /dashboard transparently.
  basePath: '/dashboard',

  // ─── NEXT_PUBLIC_* vars ─────────────────────────────────────────────────────
  // Webflow Cloud only injects env vars at RUNTIME, but Next.js NEXT_PUBLIC_* vars
  // must be baked in at BUILD time. We inline the public (non-secret) values here.
  // These are all safe to be in the codebase — they are publishable/public keys.
  // Secret keys (STRIPE_SECRET_KEY, CLERK_SECRET_KEY, etc.) stay as runtime env vars.
  env: {
    // Clerk — publishable key is intentionally public
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
      'pk_test_ZW5qb3llZC1nbGlkZXItNTguY2xlcmsuYWNjb3VudHMuZGV2JA',

    // Clerk redirect URLs — must include basePath (/dashboard) since Clerk
    // uses these as raw URL strings and is NOT aware of Next.js basePath.
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/dashboard/sign-in',
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/dashboard/sign-up',
    // Use fallbackRedirectUrl (Clerk v5+ naming) to suppress deprecation warnings
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/dashboard/overview',
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/dashboard/overview',
    // Keep legacy names as fallback for older Clerk SDK paths
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: '/dashboard/overview',
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: '/dashboard/overview',

    // The Tahi Studio org ID — determines who sees the admin view
    NEXT_PUBLIC_TAHI_ORG_ID:
      process.env.NEXT_PUBLIC_TAHI_ORG_ID ?? 'org_3BTHLj5IhFDy8DnaI2ytVbt4WrG',

    // Stripe — publishable key is intentionally public
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
      'pk_test_51TF61F2MOtshRPkAvZyS5RiWaYJm6wAkfYXCUSsN79JN0TbG2WzfNVFQmVdKnMtBdx0yZo1lGLopXDCQWrrCAyHQ00vLIsERvm',

    // Loom — app ID is public (used in the embed SDK)
    NEXT_PUBLIC_LOOM_APP_ID:
      process.env.NEXT_PUBLIC_LOOM_APP_ID ?? '71cf0991-7ce1-4a0b-a964-57957d84d22f',

    // App URL — points to the live dashboard
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ?? 'https://tahi-test-dashboard.webflow.io/dashboard',
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
}

export default nextConfig
