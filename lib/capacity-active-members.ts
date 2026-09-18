/**
 * lib/capacity-active-members.ts - which team members count towards the
 * owner overview's "Studio capacity" card. Pulled out of the route so it can
 * be unit tested without a D1 mock.
 *
 * `teamMembers` carries no active/status flag today, so "active" for this
 * card falls back to two signals:
 *   1. Not on `email.blockedAddresses` - the studio's own gate for who
 *      should not be treated as a live inbox, checked address-normalised
 *      (case-insensitive, alias-stripped) the same way the email gate itself
 *      compares addresses.
 *   2. `weeklyCapacityHours` is a positive number - 0 or null means the
 *      person carries no bookable capacity to begin with, so counting their
 *      0% utilisation row would only make the studio look emptier than it is.
 *
 * If teamMembers ever grows a real active/status column, that should
 * supersede both of these; see CLAUDE.md's Planned Schema Additions.
 */

import { addressKey } from '@/lib/email-allowlist'

export interface CapacityMemberCandidate {
  email: string
  weeklyCapacityHours: number | null
}

export function isActiveTeamMember(
  member: CapacityMemberCandidate,
  blockedAddresses: readonly string[],
): boolean {
  if (!member.weeklyCapacityHours || member.weeklyCapacityHours <= 0) return false
  const blocked = new Set(blockedAddresses.map(addressKey))
  return !blocked.has(addressKey(member.email))
}
