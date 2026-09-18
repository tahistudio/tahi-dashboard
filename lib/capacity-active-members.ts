/**
 * lib/capacity-active-members.ts - which team members count towards the
 * owner overview's "Studio capacity" card. Pulled out of the route so it can
 * be unit tested without a D1 mock.
 *
 * `teamMembers` carries no active/status flag today, so "active" for this
 * card falls back to two signals:
 *   1. Not on the settings key `team.inactiveMemberEmails` (a JSON array of
 *      addresses, default none). This is its own key on purpose: the email
 *      block list is about who receives mail, and its coded default names
 *      more than one person, so reusing it here would hide a working
 *      member from the roster. Addresses compare normalised the same way
 *      the email gate compares them.
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

export const INACTIVE_MEMBER_EMAILS_SETTING_KEY = 'team.inactiveMemberEmails'

/** The stored JSON array of addresses, tolerant of a missing or corrupt row. */
export function resolveInactiveMemberEmails(stored: unknown): string[] {
  if (typeof stored !== 'string' || !stored.trim()) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []
  } catch {
    return []
  }
}

export function isActiveTeamMember(
  member: CapacityMemberCandidate,
  inactiveAddresses: readonly string[],
): boolean {
  if (!member.weeklyCapacityHours || member.weeklyCapacityHours <= 0) return false
  const inactive = new Set(inactiveAddresses.map(addressKey))
  return !inactive.has(addressKey(member.email))
}
