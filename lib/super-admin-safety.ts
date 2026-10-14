import { NextResponse } from 'next/server'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import type { ResolvedAccess } from '@/lib/permissions'
import type { RequestAuthResult } from '@/lib/server-auth'
import { requireManagePermissions } from '@/lib/require-permission'
import { requireFeature } from '@/lib/require-feature'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const MUTATION_LOCK_KEY = 'permissions.ownerMutationLock'
const MUTATION_LOCK_TTL_MS = 5 * 60 * 1000

/** Recheck actual caller authorization after the mutation lock is acquired. */
export async function revalidateOwnerMutationAccess(
  database: D1,
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
  feature: string,
): Promise<{ denied: NextResponse | null; access: ResolvedAccess }> {
  // The initial route check may predate a concurrent revocation. This repeated
  // resolution is intentional at the serialized write boundary.
  const current = await requireManagePermissions(database, auth)
  if (current.denied) return current
  return { ...current, denied: await requireFeature(auth, feature, current.access) }
}

/** Serialize owner mutations across workers using an atomic existing settings row. */
export async function acquireOwnerMutationLock(database: D1): Promise<{
  denied: NextResponse | null
  release: () => Promise<void>
}> {
  const now = new Date().toISOString()
  const claim = JSON.stringify({
    token: crypto.randomUUID(), expiresAt: new Date(Date.now() + MUTATION_LOCK_TTL_MS).toISOString(),
  })
  const rows = await database.all<{ value: string }>(sql`
    INSERT INTO settings (key, value, updated_at) VALUES (${MUTATION_LOCK_KEY}, ${claim}, ${now})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    WHERE json_extract(settings.value, '$.expiresAt') < ${now}
    RETURNING value
  `)
  if (rows.length === 0) {
    return {
      denied: NextResponse.json({ error: 'An access update is in progress. Retry shortly.' }, { status: 409 }),
      release: async () => {},
    }
  }
  return {
    denied: null,
    release: async () => {
      await database.run(sql`DELETE FROM settings WHERE key = ${MUTATION_LOCK_KEY} AND value = ${claim}`)
    },
  }
}

/** Protect the active owner seats before a role, login or roster removal. */
export async function requireSuperAdminRetention(
  database: D1,
  access: ResolvedAccess,
  teamMemberId: string,
): Promise<NextResponse | null> {
  const owners = await database
    .select({ id: schema.teamMembers.id, clerkUserId: schema.teamMembers.clerkUserId })
    .from(schema.teamMemberRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.teamMemberRoles.roleId))
    .innerJoin(schema.teamMembers, eq(schema.teamMembers.id, schema.teamMemberRoles.teamMemberId))
    .where(and(eq(schema.roles.name, 'super_admin'), isNull(schema.teamMemberRoles.endedAt)))

  const target = owners.find(owner => owner.id === teamMemberId)
  if (!target) return null
  if (!access.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const usableOwners = new Set(owners.filter(owner => owner.clerkUserId?.trim()).map(owner => owner.id))
  if (new Set(owners.map(owner => owner.id)).size <= 1 || (target.clerkUserId?.trim() && usableOwners.size <= 1)) {
    return NextResponse.json({ error: 'The last super admin cannot be removed or demoted.' }, { status: 409 })
  }
  return null
}
