/**
 * app/api/admin/announcements/_access.ts
 *
 * Announcement scoping.
 *
 * An announcement is a broadcast, so the decision that matters is WRITE, not
 * READ: a member scoped to two clients must not be able to publish (or email)
 * a banner that lands on every client's portal.
 *
 *   write  - an unrestricted caller keeps every targeting option. A restricted
 *            caller may only write org-targeted announcements where EVERY
 *            target org is inside their scope. 'all' and 'plan_type' fan out
 *            past their scope by definition, so they are refused.
 *   read   - 'all' and 'plan_type' announcements name no client, so they stay
 *            visible to the whole team. Org-targeted ones are listed only when
 *            they touch at least one org the caller can see.
 */

import type { OrgScope } from '@/lib/access-scope'
import { areAllOrgsInScope } from '../_scoping/org-scope'

export type AnnouncementTargeting = {
  targetType: string
  targetIds: readonly string[] | null
}

/** Parse the stored JSON array of org ids, tolerating null and malformed rows. */
export function parseTargetIds(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return null
  }
}

/** May this caller create, edit, publish, email or delete this announcement? */
export function canWriteAnnouncement(scope: OrgScope, targeting: AnnouncementTargeting): boolean {
  if (scope.kind === 'all') return true
  if (scope.kind === 'none') return false
  if (targeting.targetType !== 'org') return false
  return areAllOrgsInScope(scope, targeting.targetIds ?? [])
}

/** May this caller see the announcement in the admin list? */
export function canReadAnnouncement(scope: OrgScope, targeting: AnnouncementTargeting): boolean {
  if (scope.kind === 'all') return true
  if (targeting.targetType !== 'org') return true
  if (scope.kind === 'none') return false
  const ids = targeting.targetIds ?? []
  return ids.some((id) => scope.orgIds.includes(id))
}

/** Message returned to a restricted caller who tried to broadcast too widely. */
export const BROADCAST_DENIED =
  'You can only publish announcements targeted at the clients you have access to'
