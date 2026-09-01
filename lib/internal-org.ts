/**
 * lib/internal-org.ts
 *
 * The one hidden organisation that general (no client) time logs against.
 * time_entries.org_id is NOT NULL, so studio-internal time needs an org
 * row. This row has status 'internal': the clients list excludes it by
 * default, it never gets a Clerk org, and it never appears in the portal.
 * Created idempotently on first use; the fixed id keeps it stable across
 * environments.
 */
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import type { drizzle as drizzleFn } from 'drizzle-orm/d1'

type Drizzle = ReturnType<typeof drizzleFn>

export const INTERNAL_ORG_ID = 'org_tahi_internal'
export const INTERNAL_ORG_NAME = 'Tahi Studio (internal)'
export const INTERNAL_ORG_STATUS = 'internal'

export async function ensureInternalOrg(drizzle: Drizzle): Promise<string> {
  const [existing] = await drizzle
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, INTERNAL_ORG_ID))
    .limit(1)
  if (existing) return INTERNAL_ORG_ID
  const now = new Date().toISOString()
  await drizzle.insert(schema.organisations).values({
    id: INTERNAL_ORG_ID,
    name: INTERNAL_ORG_NAME,
    status: INTERNAL_ORG_STATUS,
    planType: 'none',
    healthStatus: 'green',
    createdAt: now,
    updatedAt: now,
  })
  return INTERNAL_ORG_ID
}
