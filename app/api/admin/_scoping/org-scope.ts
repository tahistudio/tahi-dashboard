/**
 * app/api/admin/_scoping/org-scope.ts
 *
 * Shared org-scoping primitives for the deals / conversations / calls /
 * time / announcements admin routes. Pure functions only, so the scoping
 * decisions can be unit tested without a database.
 *
 * The privileged bypasses (owner, super_admin, admin, MCP service token) are
 * decided upstream by `scopedOrgIds` in lib/access-scope.ts. Everything here
 * only interprets the resulting `OrgScope`:
 *
 *   { kind: 'all' }  -> no filter at all (behaviour identical to before scoping)
 *   { kind: 'none' } -> sees nothing (never "no filter")
 *   { kind: 'some' } -> restricted to orgIds
 */

import { inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import type { OrgScope } from '@/lib/access-scope'

/**
 * How a row whose org column is NULL should be treated. NULL means the row is
 * not attached to any client tenant yet (an unlinked deal, a pre-client
 * discovery call, a Tahi-internal conversation), so it cannot leak one
 * client's data to another and each surface picks its own rule.
 *
 *   'deny'               - hide it from any restricted caller
 *   'allow-if-any-scope' - visible unless the caller is scoped to nothing
 *   'allow'              - always visible (access is governed by something
 *                          else, e.g. conversation participation)
 */
export type UnassignedRule = 'deny' | 'allow-if-any-scope' | 'allow'

/**
 * D1 rejects a statement with more than 100 bound parameters. Past this many
 * scope ids the list is inlined as validated literals instead of binds so a
 * large `plan_type` scope cannot blow the cap.
 */
export const MAX_BOUND_IDS = 90

/**
 * Ids that reach raw SQL must not be able to carry quotes or whitespace.
 * Every id we filter on is a UUID or a Clerk-style id from our own D1, so
 * anything outside this alphabet is dropped, which narrows the filter
 * (fail closed) rather than widening it.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export function safeIds(ids: readonly string[]): string[] {
  return ids.filter((id) => SAFE_ID.test(id))
}

/**
 * `column IN (...ids)`, optionally OR'd with `column IS NULL`.
 * An empty (or fully rejected) id list yields a never-true condition.
 */
export function columnInIds(
  column: SQLWrapper,
  ids: readonly string[],
  opts: { includeNull?: boolean } = {},
): SQL {
  const safe = safeIds(ids)
  let base: SQL
  if (safe.length === 0) {
    base = sql`1 = 0`
  } else if (safe.length <= MAX_BOUND_IDS) {
    base = inArray(column, safe)
  } else {
    base = sql`${column} in (${sql.raw(safe.map((id) => `'${id}'`).join(','))})`
  }
  return opts.includeNull ? sql`(${base} or ${column} is null)` : base
}

/**
 * SQL filter for an org column given a restricted scope. Only call this for
 * `{ kind: 'some' }`; 'all' needs no filter and 'none' must short-circuit to
 * an empty response before the query runs.
 */
export function orgColumnInScope(
  column: SQLWrapper,
  orgIds: readonly string[],
  opts: { includeNull?: boolean } = {},
): SQL {
  return columnInIds(column, orgIds, opts)
}

/** Whether a single row's org column is visible to this caller. */
export function isOrgInScope(
  scope: OrgScope,
  orgId: string | null | undefined,
  unassigned: UnassignedRule = 'deny',
): boolean {
  // Unrestricted first: an owner / super-admin / service token is never
  // filtered, whatever the unassigned rule says.
  if (scope.kind === 'all') return true
  if (orgId === null || orgId === undefined) {
    if (unassigned === 'allow') return true
    if (unassigned === 'allow-if-any-scope') return scope.kind !== 'none'
    return false
  }
  if (scope.kind === 'none') return false
  return scope.orgIds.includes(orgId)
}

/**
 * Whether every org in `orgIds` is visible. Used for fan-out writes (an
 * announcement blast) where partial access must not authorise the whole send.
 * An empty list is not a licence to target everyone, so it returns false for a
 * restricted caller.
 */
export function areAllOrgsInScope(scope: OrgScope, orgIds: readonly string[]): boolean {
  if (scope.kind === 'all') return true
  if (scope.kind === 'none') return false
  if (orgIds.length === 0) return false
  return orgIds.every((id) => scope.orgIds.includes(id))
}
