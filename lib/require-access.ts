/**
 * lib/require-access.ts
 *
 * Guard helpers for admin API routes that operate on a specific org's data.
 *
 * Builds on lib/access-scoping.ts (which lists allowed org IDs for a user)
 * and returns a NextResponse 403/404 when the current user is not allowed
 * to see the target org.
 *
 * Usage in a route handler:
 *
 *   const { orgId: authOrgId, userId } = await getRequestAuth(req)
 *   if (!isTahiAdmin(authOrgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 *
 *   const database = await db() as D1
 *   const targetOrgId = await findTargetOrgIdForEntity(database, 'request', params.id)
 *   const denied = await requireAccessToOrg(database, userId, targetOrgId)
 *   if (denied) return denied
 *
 * Admins (main Tahi org, role === 'admin', or no teamMembers row at all — i.e. the
 * NEXT_PUBLIC_TAHI_ORG_ID owner) bypass scoping. Team members without any
 * access rules are denied by default.
 */

import { NextResponse } from 'next/server'
import { resolveAccessScoping } from '@/lib/access-scoping'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Check whether the authenticated user has access to the given org.
 * Returns a 403 NextResponse if denied, otherwise null.
 * A null targetOrgId means the entity couldn't be located; returns 404.
 */
export async function requireAccessToOrg(
  database: DrizzleDB,
  userId: string | null,
  targetOrgId: string | null | undefined,
): Promise<NextResponse | null> {
  if (!targetOrgId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const allowedOrgIds = await resolveAccessScoping(database, userId)

  // null = unrestricted (admin or all_clients rule)
  if (allowedOrgIds === null) return null

  if (!allowedOrgIds.includes(targetOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}

/**
 * Convenience: throws-style guard that returns the allowed-org-ids list
 * (or null for unrestricted) so a caller can add it as a SQL IN filter.
 *
 *   const scope = await getOrgScope(database, userId)
 *   if (scope !== null) conditions.push(inArray(schema.invoices.orgId, scope))
 *
 * Returns [] for "no access at all" — callers should early-return with
 * an empty result set rather than running the query.
 */
export async function getOrgScope(
  database: DrizzleDB,
  userId: string | null,
): Promise<string[] | null> {
  return resolveAccessScoping(database, userId)
}
