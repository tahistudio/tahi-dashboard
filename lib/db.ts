/**
 * lib/db.ts
 * Unified DB helper for Next.js API routes on Webflow Cloud (Cloudflare Workers).
 *
 * Uses getCloudflareContext() from @opennextjs/cloudflare : the correct way to
 * access D1 bindings in Next.js routes running on Cloudflare Workers.
 *
 * For local dev: run `npm run dev:wrangler` which starts wrangler dev and
 * provides proper D1 bindings. `npm run dev` (next dev) can also be used
 * but requires the D1 binding via wrangler.
 */
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getDB } from '@/db/d1'

// Auto-migration on cold start DISABLED (2026-04-16).
// The drizzle/migrations/ folder has 16+ files but the journal only
// tracks 6 (Drizzle-generated ones). Extra manually-written migrations
// (0006-0016) confuse the Drizzle D1 migrator and cause the db() call
// to fail, taking down the entire API.
// Migrations are now applied ONLY via POST /api/admin/db/migrate which
// uses sql.raw() directly and handles "duplicate column" errors safely.

export async function db() {
  const { env } = await getCloudflareContext({ async: true })
  if (!env?.DB) {
    throw new Error(
      'D1 database binding (DB) not found in Cloudflare context.\n' +
      'Production: ensure the D1 database is created in Webflow Cloud Storage ' +
      'and the binding is uncommented in wrangler.jsonc.\n' +
      'Local dev: run `npm run dev:wrangler` instead of `npm run dev`.'
    )
  }
  return getDB(env as CloudflareEnv)
}
