/**
 * db/d1.ts
 * Production-only DB helper: Drizzle ORM over Cloudflare D1.
 * This file has NO references to @libsql/client or any Node-only packages,
 * so it is safe to bundle for Cloudflare Workers (via esbuild).
 *
 * All API routes and lib/db.ts import from here.
 * Local dev uses db/local.ts (never bundled into production).
 */
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export type DB = ReturnType<typeof getDB>

export function getDB(env: CloudflareEnv) {
  return drizzle(env.DB, { schema })
}

export { schema }
