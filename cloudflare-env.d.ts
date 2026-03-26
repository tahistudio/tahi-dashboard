/// <reference types="@cloudflare/workers-types" />

// Augment Next.js with Cloudflare D1 and R2 bindings
// These are injected by Webflow Cloud (Cloudflare Workers) at runtime.
declare global {
  interface CloudflareEnv {
    DB: D1Database
    STORAGE: R2Bucket
  }
}

export {}
