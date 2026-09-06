/**
 * lib/acting-eligibility.ts: one answer to "may this session act as a client",
 * shared by the route that arms the mode, the auth helper that re-proves it on
 * every acting write, and the upload confirm route that decides whether a file
 * belongs in the acting trail.
 *
 * Three callers asking the same question in three different ways is how a
 * surface ends up meaning two things: /api/uploads/confirm used to decide from
 * the two browser cookies alone, so an admin who could never pass the gate
 * anywhere else could still produce `acting_as_client.*` rows.
 *
 * Deny by default, and deny for a reason a person can act on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolvePermissions = vi.fn()
const resolveTeamMember = vi.fn()

vi.mock('@/lib/permissions', () => ({
  resolvePermissions: (...a: unknown[]) => resolvePermissions(...a),
}))
vi.mock('@/lib/team-identity', () => ({
  resolveTeamMember: (...a: unknown[]) => resolveTeamMember(...a),
}))

import { resolveActEligibility } from '@/lib/acting-eligibility'

type Drizzle = Parameters<typeof resolveActEligibility>[0]
const database = {} as Drizzle

const MEMBER = { id: 'tm_liam', role: 'admin', name: 'Liam Miller' }

beforeEach(() => {
  vi.clearAllMocks()
  resolvePermissions.mockResolvedValue({ isSuperAdmin: true })
  resolveTeamMember.mockResolvedValue(MEMBER)
})

describe('resolveActEligibility', () => {
  it('allows a super admin with a roster row, and hands back the person', async () => {
    const verdict = await resolveActEligibility(database, 'user_liam', 'org_tahi')
    expect(verdict.ok).toBe(true)
    expect(verdict.reason).toBeNull()
    // The row is returned rather than merely proven: the acting identity needs
    // the id to attribute the write to and the name for the byline, and both
    // came free with the lookup that proved the right.
    expect(verdict.member).toEqual(MEMBER)
  })

  it('refuses a Tahi admin who is not a super admin, without looking further', async () => {
    resolvePermissions.mockResolvedValue({ isSuperAdmin: false })
    const verdict = await resolveActEligibility(database, 'user_someone', 'org_tahi')
    expect(verdict.ok).toBe(false)
    expect(verdict.member).toBeNull()
    expect(verdict.reason).toMatch(/super admins/i)
    expect(resolveTeamMember).not.toHaveBeenCalled()
  })

  it('refuses a super admin with no team_members row', async () => {
    // The MCP service token is the usual traveller here: verified by
    // TAHI_API_TOKEN, no roster row by design, so nobody to attribute to.
    resolveTeamMember.mockResolvedValue(null)
    const verdict = await resolveActEligibility(database, 'api-service', 'org_tahi')
    expect(verdict.ok).toBe(false)
    expect(verdict.member).toBeNull()
    expect(verdict.reason).toMatch(/team member profile/i)
  })

  it('refuses a caller with no identity at all, before any query', async () => {
    for (const [userId, orgId] of [
      [null, 'org_tahi'],
      ['user_liam', null],
      [null, null],
    ] as [string | null, string | null][]) {
      vi.clearAllMocks()
      const verdict = await resolveActEligibility(database, userId, orgId)
      expect(verdict.ok).toBe(false)
      expect(verdict.reason).toMatch(/sign in/i)
      expect(resolvePermissions).not.toHaveBeenCalled()
    }
  })

  it('asks the resolver about the CALLER, never about the previewed org', async () => {
    // The right to act comes from the Tahi-side identity. Passing the client's
    // org would ask the wrong question and could resolve a client audience.
    await resolveActEligibility(database, 'user_liam', 'org_tahi')
    expect(resolvePermissions).toHaveBeenCalledWith(database, {
      userId: 'user_liam',
      orgId: 'org_tahi',
    })
  })

  it('lets a resolver failure propagate, so callers fail closed on their own terms', async () => {
    resolvePermissions.mockRejectedValue(new Error('D1 unavailable'))
    await expect(resolveActEligibility(database, 'user_liam', 'org_tahi')).rejects.toThrow()
  })
})
