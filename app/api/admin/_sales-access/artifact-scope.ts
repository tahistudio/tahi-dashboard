/**
 * Org-scoping helpers shared by the sales artifact admin routes
 * (contracts, proposals, schedules).
 *
 * OWNERSHIP RULE
 * An artifact belongs to `orgId` when that column is set, otherwise to the org
 * behind its linked deal (the same resolution the existing
 * /api/admin/schedules/[id]/linked-work route already uses). An artifact with
 * neither is UNASSIGNED: a blank draft, or one attached only to a
 * pre-conversion lead. Unassigned artifacts belong to no client, so only
 * unrestricted callers (owner / super_admin / admin / MCP service token) may
 * read or write them, and a scoped member cannot create one. That keeps an
 * unlinked row from becoming a cross-tenant hole and stops a scoped member
 * from minting a draft they would then be unable to see.
 *
 * Global templates (contract / proposal / schedule templates) carry no client
 * data and stay unscoped. Snapshotting a template FROM a live artifact does go
 * through these guards, because that copies one client's content.
 *
 * SECURITY INVARIANT: `scopedOrgIds` resolves the privileged bypasses first, so
 * an unrestricted caller returns `{ kind: 'all' }` here and every guard exits
 * before any filter or extra lookup happens. Behaviour for admins, for the
 * studio owners, and for the MCP service token is therefore unchanged.
 */

import { NextResponse } from 'next/server'
import { schema } from '@/db/d1'
import { eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { scopedOrgIds, type OrgScope } from '@/lib/access-scope'
import { requireAccessToOrg } from '@/lib/require-access'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * D1 caps a statement at 100 bound parameters. A list query also binds its own
 * filters, so cap the inlined org ids well below that and fall back to
 * in-memory filtering when a member's scope is wider (roughly 55 orgs exist
 * today, so this is headroom rather than a live problem).
 */
export const MAX_BOUND_ORG_IDS = 90

/** The linkage columns every sales artifact shares. */
export interface ArtifactRef {
  orgId?: string | null
  dealId?: string | null
}

interface AuthRef {
  userId: string | null
  orgId: string | null
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

// ── List scoping ────────────────────────────────────────────────────────────

/**
 * Pure keep/drop decision for one row of a scoped list.
 *
 * `dealOrgById` carries the resolved org for every deal referenced by an
 * orgId-less row. A row that resolves to no org at all is unassigned and is
 * dropped, since only restricted callers reach this function.
 */
export function keepArtifactForScope(
  row: ArtifactRef,
  allowedOrgIds: ReadonlySet<string>,
  dealOrgById: ReadonlyMap<string, string | null>,
): boolean {
  if (row.orgId) return allowedOrgIds.has(row.orgId)
  if (row.dealId) {
    const dealOrgId = dealOrgById.get(row.dealId)
    return !!dealOrgId && allowedOrgIds.has(dealOrgId)
  }
  return false
}

/**
 * Optional SQL pre-filter for a scoped list: rows owned by an allowed org, plus
 * orgId-less rows whose deal linkage still has to be resolved in memory.
 * Returns undefined when the id list would risk D1's bound-parameter cap, in
 * which case the caller runs the query unfiltered and relies on
 * `filterArtifactsByScope`, which is the authority either way.
 */
export function scopedOrgCondition(
  column: SQLiteColumn,
  allowedOrgIds: string[],
): SQL | undefined {
  if (allowedOrgIds.length === 0 || allowedOrgIds.length > MAX_BOUND_ORG_IDS) return undefined
  return or(inArray(column, allowedOrgIds), isNull(column))
}

/** Resolve deal ids to their org, chunked under D1's bound-parameter cap. */
export async function resolveDealOrgs(
  database: DrizzleDB,
  dealIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  const unique = Array.from(new Set(dealIds))
  for (let i = 0; i < unique.length; i += MAX_BOUND_ORG_IDS) {
    const chunk = unique.slice(i, i + MAX_BOUND_ORG_IDS)
    const rows = await database
      .select({ id: schema.deals.id, orgId: schema.deals.orgId })
      .from(schema.deals)
      .where(inArray(schema.deals.id, chunk))
    for (const row of rows) map.set(row.id, row.orgId ?? null)
  }
  return map
}

/**
 * Authoritative list filter for a caller restricted to `allowedOrgIds`.
 * Never call this for an unrestricted caller: it drops unassigned rows.
 */
export async function filterArtifactsByScope<T extends ArtifactRef>(
  database: DrizzleDB,
  rows: T[],
  allowedOrgIds: string[],
): Promise<T[]> {
  const allowed = new Set(allowedOrgIds)
  const dealIds = rows.filter(r => !r.orgId && r.dealId).map(r => r.dealId as string)
  const dealOrgById = dealIds.length
    ? await resolveDealOrgs(database, dealIds)
    : new Map<string, string | null>()
  return rows.filter(row => keepArtifactForScope(row, allowed, dealOrgById))
}

// ── Single-artifact guards ──────────────────────────────────────────────────

/** Resolve the org that owns an artifact: own column first, then its deal. */
export async function resolveArtifactOrgId(
  database: DrizzleDB,
  artifact: ArtifactRef,
): Promise<string | null> {
  if (artifact.orgId) return artifact.orgId
  if (!artifact.dealId) return null
  const [deal] = await database
    .select({ orgId: schema.deals.orgId })
    .from(schema.deals)
    .where(eq(schema.deals.id, artifact.dealId))
    .limit(1)
  return deal?.orgId ?? null
}

/**
 * `artifact` is undefined when the row could not be found. A restricted caller
 * gets 404 there; an unrestricted caller has already returned above, so routes
 * that silently no-op on a missing row keep doing exactly that for admins.
 */
async function decideArtifactAccess(
  database: DrizzleDB,
  auth: AuthRef,
  scope: OrgScope,
  artifact: ArtifactRef | null | undefined,
): Promise<NextResponse | null> {
  if (scope.kind === 'all') return null
  if (scope.kind === 'none') return forbidden()
  if (!artifact) return notFound()

  const targetOrgId = await resolveArtifactOrgId(database, artifact)
  if (!targetOrgId) return forbidden()

  return requireAccessToOrg(database, auth.userId, targetOrgId)
}

/**
 * Guard for an artifact whose linkage the caller already has: a row loaded by
 * the route, or the org/deal a create request is aiming at.
 * Returns a NextResponse to return as-is when denied, otherwise null.
 */
export async function requireArtifactAccess(
  database: DrizzleDB,
  auth: AuthRef,
  artifact: ArtifactRef | null | undefined,
): Promise<NextResponse | null> {
  return decideArtifactAccess(database, auth, await scopedOrgIds(auth), artifact)
}

/** Guard a contract document by id (used by its sub-resources too). */
export async function requireContractAccess(
  database: DrizzleDB,
  auth: AuthRef,
  contractId: string,
): Promise<NextResponse | null> {
  const scope = await scopedOrgIds(auth)
  if (scope.kind === 'all') return null
  const [row] = await database
    .select({ orgId: schema.contractDocuments.orgId, dealId: schema.contractDocuments.dealId })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.id, contractId))
    .limit(1)
  return decideArtifactAccess(database, auth, scope, row)
}

/** Guard a proposal by id (used by sections, variants, share, publish, email). */
export async function requireProposalAccess(
  database: DrizzleDB,
  auth: AuthRef,
  proposalId: string,
): Promise<NextResponse | null> {
  const scope = await scopedOrgIds(auth)
  if (scope.kind === 'all') return null
  const [row] = await database
    .select({ orgId: schema.proposals.orgId, dealId: schema.proposals.dealId })
    .from(schema.proposals)
    .where(eq(schema.proposals.id, proposalId))
    .limit(1)
  return decideArtifactAccess(database, auth, scope, row)
}

/** Guard a project schedule by id (used by rows, sections, share, publish). */
export async function requireScheduleAccess(
  database: DrizzleDB,
  auth: AuthRef,
  scheduleId: string,
): Promise<NextResponse | null> {
  const scope = await scopedOrgIds(auth)
  if (scope.kind === 'all') return null
  const [row] = await database
    .select({ orgId: schema.projectSchedules.orgId, dealId: schema.projectSchedules.dealId })
    .from(schema.projectSchedules)
    .where(eq(schema.projectSchedules.id, scheduleId))
    .limit(1)
  return decideArtifactAccess(database, auth, scope, row)
}

/** Re-exported so list routes pull the scope and these rules from one module. */
export { scopedOrgIds }
export type { OrgScope }
