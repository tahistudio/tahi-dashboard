/**
 * lib/access-scope.ts
 *
 * Ergonomic, FAIL-CLOSED wrapper over lib/access-scoping.ts for admin list
 * routes.
 *
 * `resolveAccessScoping` returns `string[] | null`, where `null` means
 * "unrestricted" and `[]` means "deny all". That raw shape is easy to invert by
 * accident (a forgotten `.length === 0` check silently leaks every org) AND it
 * overloads `null` across three very different situations: an explicit
 * `all_clients` grant, a legacy `role === 'admin'` member, and a caller with no
 * `teamMembers` row at all. `scopedOrgIds` layers on top so callers get a
 * discriminated `OrgScope` with named sentinels (TypeScript forces every caller
 * to handle deny-all) AND so the privileged bypass is decided by
 * `resolvePermissions` rather than by that ambiguous `null`.
 *
 * The underlying per-org scoping logic is NOT reimplemented here; this helper
 * only decides who bypasses it and what an empty result means:
 *
 *   { kind: 'all' }  -> apply no org filter
 *   { kind: 'none' } -> deny (return an empty result set; do NOT run the query)
 *   { kind: 'some' } -> filter with inArray(..., orgIds)
 *
 * SECURITY INVARIANT (never violate): the studio owner + super-admins, the Tahi
 * admin org, and the MCP service token ALWAYS keep full access. Those bypasses
 * are evaluated BEFORE the fail-closed deny path, so tightening the default can
 * never lock them out. The fail-closed change applies ONLY to a non-super-admin,
 * non-admin team member with no configured access rule: they now resolve to
 * `{ kind: 'none' }` (no orgs) instead of leaking every client.
 *
 * Single-entity routes keep using `requireAccessToOrg` from lib/require-access.ts.
 *
 * Usage in an admin list route (CLAUDE.md rule 11):
 *
 *   import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
 *   import { scopedOrgIds } from '@/lib/access-scope'
 *   import { inArray } from 'drizzle-orm'
 *
 *   export async function GET(req: NextRequest) {
 *     const auth = await getRequestAuth(req)
 *     if (!isTahiAdmin(auth.orgId)) {
 *       return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 *     }
 *     const scope = await scopedOrgIds(auth)
 *     if (scope.kind === 'none') return NextResponse.json({ requests: [] }) // deny all
 *
 *     const database = await db()
 *     const conditions = []
 *     if (scope.kind === 'some') {
 *       conditions.push(inArray(schema.requests.orgId, scope.orgIds))
 *     }
 *     // ... run the query with conditions ...
 *   }
 */

import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { resolvePermissions } from '@/lib/permissions'
import type { RequestAuthResult } from '@/lib/server-auth'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * The set of org IDs a caller may see, as a discriminated union.
 *
 *   'all'  - unrestricted (admin / super-admin / all_clients rule); no org filter
 *   'none' - deny by default (team member with no access rules); return empty
 *   'some' - restricted to `orgIds`; filter with `inArray(..., orgIds)`
 */
export type OrgScope =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'some'; orgIds: string[] }

/**
 * Resolve the org-ID scope for an authenticated caller, FAIL-CLOSED.
 *
 * Accepts the `getRequestAuth` result (`userId` + `orgId`) and resolves the D1
 * handle internally, so list routes that don't otherwise need a `database`
 * handle stay clean.
 *
 * Decision order (privileged bypasses first, so the owner/super-admins can never
 * be locked out by the deny path):
 *   1. MCP service token -> { all }.
 *   2. super_admin / admin level (via resolvePermissions) -> { all }.
 *   3. otherwise apply the team member's configured access rules:
 *        null -> { all }  (explicit all_clients / legacy-admin grant)
 *        []   -> { none } (no rule configured: DENY by default)
 *        list -> { some }
 */
export async function scopedOrgIds(
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
): Promise<OrgScope> {
  const database = await db()

  // ── SECURITY INVARIANT (never violate) ─────────────────────────────────────
  // The bypasses below run BEFORE the fail-closed deny path so the owner,
  // super-admins, admins, and the MCP token can never resolve to { none }.

  // 1. MCP / service-to-service token. `getRequestAuth` mints userId
  //    'api-service' ONLY for a verified TAHI_API_TOKEN, so this is safe and
  //    keeps MCP parity (CLAUDE.md rule 14) even if the role/permission tables
  //    are mid-migration or empty (in which case resolveAccessScoping could
  //    otherwise return [] and deny the service token).
  if (auth.userId === 'api-service') return { kind: 'all' }

  // 2. super_admin (seeded owner business@ + staci@, un-lockable) and admin
  //    level (explicit admin role, or the Tahi-org "no role assigned" default)
  //    bypass scoping. resolvePermissions is the single source of truth for the
  //    admin decision, so the owner is protected here regardless of the legacy
  //    `teamMembers.role` column or whether any `teamMemberAccess` rows exist.
  //    This is STRICTLY SAFER than the old `null -> all` mapping: even if a
  //    misconfiguration made resolveAccessScoping return [] for the owner, they
  //    still resolve to { all } here instead of being denied.
  const access = await resolvePermissions(database as DrizzleDB, {
    userId: auth.userId,
    orgId: auth.orgId,
  })
  if (access.isAdmin) return { kind: 'all' }

  // ── Non-admin team member: FAIL CLOSED ──────────────────────────────────────
  // Only genuine (non-admin) team members reach here.
  //   null -> an explicit all_clients rule or a legacy role==='admin' grant:
  //           an intentional "see everything", so keep { all }.
  //   []   -> NO configured access rule: deny by default -> { none }.
  //   list -> the specific orgs the member's rules allow -> { some }.
  const ids = await resolveAccessScoping(database as DrizzleDB, auth.userId)
  if (ids === null) return { kind: 'all' }
  if (ids.length === 0) return { kind: 'none' }
  return { kind: 'some', orgIds: ids }
}
