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

// HOTFIX #6: keep schema (needed for typed queries) but absolutely
// NO migrate import. The drizzle-orm/d1/migrator module imports Node.js
// fs APIs that may not work on newer Cloudflare Workers runtimes.
// Even though it was caught by try/catch, the mere IMPORT of the
// module might crash the Worker during bundling or initialization.

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
