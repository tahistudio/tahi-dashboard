import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export type DB = ReturnType<typeof getDB>

/**
 * Production (Webflow Cloud): pass the D1 binding from env.
 * Usage in API routes:
 *   import { getDB } from '@/db'
 *   const db = getDB((process.env as unknown as CloudflareEnv))
 */
export function getDB(env: CloudflareEnv) {
  return drizzle(env.DB, { schema })
}

/**
 * Local development: use a local SQLite file.
 * Only called when NODE_ENV === 'development'.
 */
let _localDB: ReturnType<typeof drizzle> | null = null

export async function getLocalDB() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('getLocalDB() is for local dev only.')
  }
  if (!_localDB) {
    const { createClient } = await import('@libsql/client')
    const { drizzle: drizzleLibsql } = await import('drizzle-orm/libsql')
    const client = createClient({ url: 'file:./dev.db' })
    // Cast to compatible type — same schema, different driver
    _localDB = drizzleLibsql(client, { schema }) as unknown as ReturnType<typeof drizzle>
  }
  return _localDB
}

export { schema }
