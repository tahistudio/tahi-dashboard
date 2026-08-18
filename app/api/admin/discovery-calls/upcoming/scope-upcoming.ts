/**
 * app/api/admin/discovery-calls/upcoming/scope-upcoming.ts
 *
 * Pure visibility decision for the upcoming-calls widget (teammate home +
 * owner home). Lives beside route.ts (not in it) because route files may
 * only export HTTP methods, and so the decision is unit-testable without D1.
 *
 * A discovery call is client data when it, or any linked parent, belongs to
 * an org. The SQL pre-filter in route.ts keeps rows whose own orgId is in
 * scope OR null; this helper is the authority for the null-orgId rows, where
 * an org can still be reachable through a linked deal / request / task.
 *
 * Rules for a restricted caller ({ kind: 'some' }):
 *   - direct orgId set   -> that org must be in scope
 *   - linked parent orgs -> EVERY resolved parent org must be in scope
 *                           (multi-parent calls fail closed)
 *   - no client linkage  -> pre-client call (lead-only / unclassified
 *                           calendar import): visible to anyone holding a
 *                           scope, matching calls/index 'allow-if-any-scope'
 *
 * The privileged bypasses (owner, super_admin, admin, MCP service token) are
 * decided upstream by scopedOrgIds and arrive here as { kind: 'all' }, which
 * never filters, so owner behaviour is byte-identical to before scoping.
 */

import type { OrgScope } from '@/lib/access-scope'
import { isOrgInScope } from '../../_scoping/org-scope'

export interface UpcomingCallLinkage {
  orgId: string | null
  dealId: string | null
  requestId: string | null
  taskId: string | null
}

export interface ParentOrgIndex {
  dealOrgById: ReadonlyMap<string, string | null>
  requestOrgById: ReadonlyMap<string, string | null>
  taskOrgById: ReadonlyMap<string, string | null>
}

export function keepUpcomingCallForScope(
  scope: OrgScope,
  call: UpcomingCallLinkage,
  parents: ParentOrgIndex,
): boolean {
  if (scope.kind === 'all') return true
  if (scope.kind === 'none') return false

  if (call.orgId) return isOrgInScope(scope, call.orgId)

  // A dangling parent id (row deleted, or orgless deal) resolves to nothing
  // and contributes no org: it cannot carry client data, so it falls through
  // to the pre-client rule below rather than blocking the row.
  const parentOrgs: string[] = []
  if (call.dealId) {
    const org = parents.dealOrgById.get(call.dealId)
    if (org) parentOrgs.push(org)
  }
  if (call.requestId) {
    const org = parents.requestOrgById.get(call.requestId)
    if (org) parentOrgs.push(org)
  }
  if (call.taskId) {
    const org = parents.taskOrgById.get(call.taskId)
    if (org) parentOrgs.push(org)
  }

  if (parentOrgs.length === 0) {
    return isOrgInScope(scope, null, 'allow-if-any-scope')
  }
  return parentOrgs.every(org => isOrgInScope(scope, org))
}
