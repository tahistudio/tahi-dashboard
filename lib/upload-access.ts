/**
 * lib/upload-access.ts
 *
 * Org-identity resolution and authorization decisions for the uploads
 * surface (/api/uploads/*).
 *
 * Two identity spaces exist: Clerk org ids (raw session orgId from
 * getRequestAuth) and D1 organisations.id (the canonical tenant key that
 * files.orgId references). Files are always OWNED by a D1 org id, and every
 * serve/metadata/delete decision authorizes off the files row. Storage keys
 * created before this convention carry a Clerk org id prefix, so the
 * legacy fallback (no files row) accepts a match in either id space.
 */

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { requireAccessToOrg } from '@/lib/require-access'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Resolve a Clerk org id to the linked D1 organisations.id.
 * Mirrors getPortalAuth: clerkOrgId column first, then the legacy case
 * where the Clerk org id IS the D1 primary key. Null when unprovisioned.
 */
export async function resolveD1OrgId(
  database: DrizzleDB,
  clerkOrgId: string | null,
): Promise<string | null> {
  if (!clerkOrgId) return null
  const [linked] = await database
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.clerkOrgId, clerkOrgId))
    .limit(1)
  if (linked) return linked.id
  const [legacy] = await database
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, clerkOrgId))
    .limit(1)
  return legacy?.id ?? null
}

/**
 * Resolve an admin-supplied target org reference to the canonical D1
 * organisations.id. Accepts a D1 id directly, or a Clerk org id for
 * tolerance with older callers. Null when no such org exists.
 */
export async function resolveTargetOrgId(
  database: DrizzleDB,
  target: string,
): Promise<string | null> {
  const [byId] = await database
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, target))
    .limit(1)
  if (byId) return byId.id
  const [byClerk] = await database
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.clerkOrgId, target))
    .limit(1)
  return byClerk?.id ?? null
}

export type OwnerOrgResolution =
  | { ok: true; ownerOrgId: string }
  | { ok: false; response: NextResponse }

/**
 * Decide which D1 org OWNS a new upload. Shared by presign (key prefix)
 * and confirm (files.orgId) so both always agree.
 *
 * Admins may name a target org explicitly (how team uploads land in a
 * client's org); otherwise a real requestId implies its org; otherwise the
 * file is Tahi-internal and keeps the Tahi Clerk org id (branding assets
 * etc, which have no organisations row). Restricted team members are held
 * to their access scoping on the target org.
 *
 * Clients NEVER choose: any supplied target is ignored and their Clerk org
 * resolves to the linked D1 organisation. A requestId that resolves to a
 * real request must belong to that org; unresolvable requestIds pass
 * because callers use pseudo tags ('branding', 'org-logo') as key path
 * segments.
 */
export async function resolveOwnerOrgForUpload(
  database: DrizzleDB,
  opts: {
    isAdmin: boolean
    userId: string | null
    callerClerkOrgId: string | null
    targetOrgId?: string | null
    requestId?: string | null
  },
): Promise<OwnerOrgResolution> {
  const { isAdmin, userId, callerClerkOrgId, targetOrgId, requestId } = opts

  if (isAdmin) {
    if (targetOrgId) {
      const resolved = await resolveTargetOrgId(database, targetOrgId)
      if (!resolved) {
        return { ok: false, response: NextResponse.json({ error: 'Unknown target org' }, { status: 400 }) }
      }
      const denied = await requireAccessToOrg(database, userId, resolved)
      if (denied) return { ok: false, response: denied }
      return { ok: true, ownerOrgId: resolved }
    }
    if (requestId) {
      const [request] = await database
        .select({ orgId: schema.requests.orgId })
        .from(schema.requests)
        .where(eq(schema.requests.id, requestId))
        .limit(1)
      if (request) {
        const denied = await requireAccessToOrg(database, userId, request.orgId)
        if (denied) return { ok: false, response: denied }
        return { ok: true, ownerOrgId: request.orgId }
      }
    }
    if (!callerClerkOrgId) {
      return { ok: false, response: NextResponse.json({ error: 'Cannot determine org' }, { status: 400 }) }
    }
    return { ok: true, ownerOrgId: callerClerkOrgId }
  }

  const ownOrgId = await resolveD1OrgId(database, callerClerkOrgId)
  if (!ownOrgId) {
    return { ok: false, response: NextResponse.json({ error: 'No provisioned workspace' }, { status: 403 }) }
  }
  if (requestId) {
    const [request] = await database
      .select({ orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1)
    if (request && request.orgId !== ownOrgId) {
      return { ok: false, response: NextResponse.json({ error: 'Request not found in your workspace' }, { status: 403 }) }
    }
  }
  return { ok: true, ownerOrgId: ownOrgId }
}

export type UploadReadDecision =
  | { outcome: 'allow' }
  | { outcome: 'deny'; status: 400 | 403; error: string }
  | { outcome: 'admin_scope_check'; targetOrgId: string }

/**
 * Pure authorization decision for reading/deleting a stored file.
 *
 * When a files row exists it is the single source of truth: admins go
 * through team-member scoping against files.orgId (the caller runs
 * requireAccessToOrg on the returned targetOrgId), clients must match it
 * with their D1 org id (or their Clerk org id, for legacy rows written
 * before the D1-id convention).
 *
 * Without a row (legacy or unconfirmed keys) we fall back to the key
 * prefix, matched against EITHER of the requester's ids since old keys
 * used Clerk prefixes and new keys use D1 prefixes.
 */
export function decideUploadRead(input: {
  isAdmin: boolean
  fileOrgId: string | null
  keyOrgId: string | null
  requesterClerkOrgId: string | null
  requesterD1OrgId: string | null
}): UploadReadDecision {
  const { isAdmin, fileOrgId, keyOrgId, requesterClerkOrgId, requesterD1OrgId } = input

  if (fileOrgId) {
    if (isAdmin) return { outcome: 'admin_scope_check', targetOrgId: fileOrgId }
    if (requesterD1OrgId && requesterD1OrgId === fileOrgId) return { outcome: 'allow' }
    if (requesterClerkOrgId && requesterClerkOrgId === fileOrgId) return { outcome: 'allow' }
    return { outcome: 'deny', status: 403, error: 'Forbidden' }
  }

  if (!keyOrgId || keyOrgId === 'anon') {
    return { outcome: 'deny', status: 400, error: 'Invalid or legacy file key' }
  }
  if (isAdmin) return { outcome: 'admin_scope_check', targetOrgId: keyOrgId }
  if (requesterClerkOrgId && requesterClerkOrgId === keyOrgId) return { outcome: 'allow' }
  if (requesterD1OrgId && requesterD1OrgId === keyOrgId) return { outcome: 'allow' }
  return { outcome: 'deny', status: 403, error: 'Forbidden' }
}
