import { NextResponse } from 'next/server'
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { can, type ResolvedAccess } from '@/lib/permissions'
import { safeIds } from '@/app/api/admin/_scoping/org-scope'
import { schema } from '@/db/d1'
import type { OrgScope } from '@/lib/access-scope'
import type { RequestAuthResult } from '@/lib/server-auth'

/** Workspace-wide operations require an admin role, not just studio membership. */
export async function requireStudioAdmin(
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
  feature: string,
): Promise<NextResponse | null> {
  const denied = await requireFeature(auth, feature)
  if (denied) return denied
  return requireAdmin(auth)
}

/** SQL fence suitable for Drizzle columns and raw-SQL aliases, before LIMIT. */
export function internalOrgFilter(scope: OrgScope, column: SQLWrapper, allowNoOrg = false): SQL {
  if (scope.kind === 'all') return sql`1 = 1`
  if (scope.kind === 'none') return sql`0 = 1`
  const ids = safeIds(scope.orgIds)
  if (ids.length === 0) return sql`0 = 1`
  // A query may compose several fences, so even small scopes use validated
  // literals rather than multiplying binds past D1's statement-wide limit.
  const allowed = sql`${column} IN (${sql.raw(ids.map(id => `'${id}'`).join(','))})`
  return allowNoOrg ? sql`(${allowed} OR ${column} IS NULL)` : allowed
}

/** Mixed overview responses also honour each source feature's visibility. */
export function internalFeatureOrgFilter(
  access: ResolvedAccess,
  feature: string,
  scope: OrgScope,
  column: SQLWrapper,
  allowNoOrg = false,
): SQL {
  return can(access, feature) ? internalOrgFilter(scope, column, allowNoOrg) : sql`0 = 1`
}

/** A request-linked message must pass both its stored org and its parent org. */
export function internalMessageFilter(access: ResolvedAccess, scope: OrgScope): SQL {
  const ownOrg = internalFeatureOrgFilter(access, 'requests', scope, schema.messages.orgId)
  if (scope.kind === 'all') return ownOrg
  const parentOrg = internalFeatureOrgFilter(access, 'requests', scope, sql`message_request.org_id`)
  return sql`${ownOrg} AND (${schema.messages.requestId} IS NULL OR EXISTS (
    SELECT 1 FROM requests AS message_request
    WHERE message_request.id = ${schema.messages.requestId} AND ${parentOrg}
  ))`
}

/** A caller-owned timer cannot reveal a target whose current client scope was withdrawn. */
export function internalTimerFilter(access: ResolvedAccess, scope: OrgScope): SQL {
  const ownOrg = internalFeatureOrgFilter(access, 'time', scope, schema.activeTimers.orgId, true)
  if (scope.kind === 'all') return ownOrg
  const requestOrg = internalFeatureOrgFilter(access, 'requests', scope, sql`timer_request.org_id`)
  const taskOrg = internalFeatureOrgFilter(access, 'tasks', scope, sql`timer_task.org_id`, true)
  return sql`${ownOrg}
    AND (${schema.activeTimers.requestId} IS NULL OR EXISTS (
      SELECT 1 FROM requests AS timer_request WHERE timer_request.id = ${schema.activeTimers.requestId} AND ${requestOrg}
    ))
    AND (${schema.activeTimers.taskId} IS NULL OR EXISTS (
      SELECT 1 FROM tasks AS timer_task WHERE timer_task.id = ${schema.activeTimers.taskId} AND ${taskOrg}
    ))`
}
