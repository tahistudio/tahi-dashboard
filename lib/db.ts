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
import { migrate } from 'drizzle-orm/d1/migrator'

let _migrated = false

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
  const database = getDB(env as CloudflareEnv)

  // Run pending migrations once per cold start (no-op if already up to date)
  if (!_migrated) {
    try {
      await migrate(database, { migrationsFolder: 'drizzle/migrations' })
      _migrated = true
    } catch (err) {
      // Log but don't crash : table may already exist on subsequent cold starts
      console.error('[db] Migration error (may be safe to ignore):', err)
      _migrated = true
    }
  }

  return database
}
