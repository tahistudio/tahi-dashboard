/// <reference types="@cloudflare/workers-types" />

// Augment Next.js with Cloudflare D1 and R2 bindings
// These are injected by Webflow Cloud (Cloudflare Workers) at runtime.
declare global {
  interface CloudflareEnv {
    DB: D1Database
    STORAGE: R2Bucket
    /**
     * Workers AI, for the Slack voice notes (CN.2 section 4). Optional
     * because a worker deployed before wrangler.json carried the binding has
     * no AI on its env, and lib/slack/voice.ts answers that with one sentence
     * rather than an error.
     */
    AI?: Ai
  }
}

export {}
