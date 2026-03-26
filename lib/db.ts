/**
 * lib/db.ts
 * Unified DB helper for API routes.
 * In production (Cloudflare Workers), reads from the D1 binding.
 * In local dev, falls back to a local SQLite file via libsql.
 */

import { getDB, getLocalDB } from '@/db'

export async function db() {
  if (process.env.NODE_ENV === 'development') {
    return getLocalDB()
  }
  // On Cloudflare Workers, the D1 binding is in the env global
  const env = (globalThis as unknown as { env?: CloudflareEnv }).env
  if (!env?.DB) {
    throw new Error(
      'D1 database binding not found. ' +
      'Ensure the DB binding is configured in wrangler.jsonc and Webflow Cloud Storage.'
    )
  }
  return getDB(env)
}
