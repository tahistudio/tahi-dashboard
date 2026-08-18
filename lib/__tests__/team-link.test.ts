/**
 * Unit tests for lib/team-link.ts.
 *
 * This is the keystone of team-member onboarding: it is the only automatic
 * writer of teamMembers.clerkUserId, which in turn drives role resolution,
 * data scoping and notification delivery. The rules it must never break:
 * verified email only, never create a row, never overwrite a link, never guess
 * between duplicate emails, and no extra work for an already-linked user.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  resolveTeamLink,
  decideCandidate,
  normaliseEmail,
  type TeamLinkCandidate,
  type TeamLinkDeps,
} from '@/lib/team-link'

const TAHI_ORG = 'org_tahi'
const HIRE = 'user_hire'

function deps(overrides: Partial<TeamLinkDeps> = {}) {
  const base = {
    findLinkedMemberId: vi.fn(async () => null as string | null),
    loadVerifiedEmail: vi.fn(async () => ({ email: 'hire@tahi.studio', verified: true })),
    findMembersByEmail: vi.fn(async () => [] as TeamLinkCandidate[]),
    linkMember: vi.fn(async () => true),
    recordOutcome: vi.fn(async () => {}),
  }
  return { ...base, ...overrides }
}

describe('normaliseEmail', () => {
  it('trims and lowercases, and rejects empties', () => {
    expect(normaliseEmail('  Hire@Tahi.Studio ')).toBe('hire@tahi.studio')
    expect(normaliseEmail('   ')).toBeNull()
    expect(normaliseEmail(null)).toBeNull()
    expect(normaliseEmail(undefined)).toBeNull()
  })
})

describe('decideCandidate', () => {
  it('links the single unclaimed match', () => {
    expect(decideCandidate([{ id: 'tm_1', email: 'a@b.c', clerkUserId: null }], HIRE))
      .toEqual({ outcome: 'link', teamMemberId: 'tm_1' })
  })

  it('treats an empty string clerkUserId as unclaimed', () => {
    expect(decideCandidate([{ id: 'tm_1', email: 'a@b.c', clerkUserId: '' }], HIRE))
      .toEqual({ outcome: 'link', teamMemberId: 'tm_1' })
  })

  it('no match when nothing carries the email', () => {
    expect(decideCandidate([], HIRE)).toEqual({ outcome: 'no_match', teamMemberId: null })
  })

  it('ambiguous when two rows share the email, and picks neither', () => {
    const out = decideCandidate([
      { id: 'tm_1', email: 'a@b.c', clerkUserId: null },
      { id: 'tm_2', email: 'a@b.c', clerkUserId: null },
    ], HIRE)
    expect(out).toEqual({ outcome: 'ambiguous', teamMemberId: null })
  })

  it('refuses a row already claimed by someone else', () => {
    expect(decideCandidate([{ id: 'tm_1', email: 'a@b.c', clerkUserId: 'user_other' }], HIRE))
      .toEqual({ outcome: 'claimed', teamMemberId: 'tm_1' })
  })

  it('reports already_linked when the match is this very user', () => {
    expect(decideCandidate([{ id: 'tm_1', email: 'a@b.c', clerkUserId: HIRE }], HIRE))
      .toEqual({ outcome: 'already_linked', teamMemberId: 'tm_1' })
  })
})

describe('resolveTeamLink', () => {
  it('no-ops for a non-Tahi org and reads nothing', async () => {
    const d = deps()
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: 'org_client', tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('not_team_org')
    expect(d.findLinkedMemberId).not.toHaveBeenCalled()
    expect(d.loadVerifiedEmail).not.toHaveBeenCalled()
    expect(d.linkMember).not.toHaveBeenCalled()
  })

  it('no-ops when NEXT_PUBLIC_TAHI_ORG_ID is unset, rather than matching null to null', async () => {
    const d = deps()
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: null, tahiOrgId: undefined })
    expect(res.outcome).toBe('not_team_org')
    expect(d.findLinkedMemberId).not.toHaveBeenCalled()
  })

  it('no-ops for the MCP service identity', async () => {
    const d = deps()
    const res = await resolveTeamLink(d, { userId: 'api-service', orgId: TAHI_ORG, tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('no_user')
    expect(d.findLinkedMemberId).not.toHaveBeenCalled()
  })

  it('already linked: stops at the miss check, no Clerk read and no write', async () => {
    const d = deps({ findLinkedMemberId: vi.fn(async () => 'tm_liam') })
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: TAHI_ORG, tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('already_linked')
    expect(res.teamMemberId).toBe('tm_liam')
    expect(d.loadVerifiedEmail).not.toHaveBeenCalled()
    expect(d.findMembersByEmail).not.toHaveBeenCalled()
    expect(d.linkMember).not.toHaveBeenCalled()
    expect(d.recordOutcome).not.toHaveBeenCalled()
  })

  it('unverified email: never links, never queries the roster', async () => {
    const d = deps({
      loadVerifiedEmail: vi.fn(async () => ({ email: 'hire@tahi.studio', verified: false })),
    })
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: TAHI_ORG, tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('email_unverified')
    expect(d.findMembersByEmail).not.toHaveBeenCalled()
    expect(d.linkMember).not.toHaveBeenCalled()
  })

  it('missing email on a verified account is treated as unverified', async () => {
    const d = deps({ loadVerifiedEmail: vi.fn(async () => ({ email: null, verified: true })) })
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: TAHI_ORG, tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('email_unverified')
    expect(d.linkMember).not.toHaveBeenCalled()
  })

  it('email match with a null clerkUserId: links it, case-insensitively', async () => {
    const d = deps({
      loadVerifiedEmail: vi.fn(async () => ({ email: '  Hire@Tahi.Studio ', verified: true })),
      findMembersByEmail: vi.fn(async () => [
        { id: 'tm_hire', email: 'HIRE@tahi.studio', clerkUserId: null },
      ]),
    })
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: TAHI_ORG, tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('linked')
    expect(res.teamMemberId).toBe('tm_hire')
    expect(d.findMembersByEmail).toHaveBeenCalledWith('hire@tahi.studio')
    expect(d.linkMember).toHaveBeenCalledWith('tm_hire', HIRE)
    expect(d.recordOutcome).toHaveBeenCalledTimes(1)
  })

  it('duplicate email matches: links none and leaves a trail', async () => {
    const d = deps({
      findMembersByEmail: vi.fn(async () => [
        { id: 'tm_a', email: 'hire@tahi.studio', clerkUserId: null },
        { id: 'tm_b', email: 'hire@tahi.studio', clerkUserId: null },
      ]),
    })
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: TAHI_ORG, tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('ambiguous')
    expect(res.teamMemberId).toBeNull()
    expect(res.matchedIds).toEqual(['tm_a', 'tm_b'])
    expect(d.linkMember).not.toHaveBeenCalled()
    expect(d.recordOutcome).toHaveBeenCalledTimes(1)
  })

  it('never creates a row when nothing matches', async () => {
    const d = deps({ findMembersByEmail: vi.fn(async () => []) })
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: TAHI_ORG, tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('no_match')
    expect(d.linkMember).not.toHaveBeenCalled()
    // no_match is the steady state for an admin with no roster row: no trail.
    expect(d.recordOutcome).not.toHaveBeenCalled()
  })

  it('never steals a row already claimed by another Clerk user', async () => {
    const d = deps({
      findMembersByEmail: vi.fn(async () => [
        { id: 'tm_liam', email: 'hire@tahi.studio', clerkUserId: 'user_liam' },
      ]),
    })
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: TAHI_ORG, tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('claimed')
    expect(d.linkMember).not.toHaveBeenCalled()
    expect(d.recordOutcome).toHaveBeenCalledTimes(1)
  })

  it('losing the compare-and-set race is benign, not a link', async () => {
    const d = deps({
      findMembersByEmail: vi.fn(async () => [
        { id: 'tm_hire', email: 'hire@tahi.studio', clerkUserId: null },
      ]),
      linkMember: vi.fn(async () => false),
    })
    const res = await resolveTeamLink(d, { userId: HIRE, orgId: TAHI_ORG, tahiOrgId: TAHI_ORG })
    expect(res.outcome).toBe('lost_race')
    expect(d.recordOutcome).not.toHaveBeenCalled()
  })

  it('is idempotent: the second pass sees the link and does nothing', async () => {
    let stored: string | null = null
    const d = deps({
      findLinkedMemberId: vi.fn(async () => (stored ? 'tm_hire' : null)),
      findMembersByEmail: vi.fn(async () => [
        { id: 'tm_hire', email: 'hire@tahi.studio', clerkUserId: stored },
      ]),
      linkMember: vi.fn(async (_id: string, clerkUserId: string) => {
        if (stored) return false
        stored = clerkUserId
        return true
      }),
    })
    const input = { userId: HIRE, orgId: TAHI_ORG, tahiOrgId: TAHI_ORG }
    expect((await resolveTeamLink(d, input)).outcome).toBe('linked')
    expect((await resolveTeamLink(d, input)).outcome).toBe('already_linked')
    expect(d.linkMember).toHaveBeenCalledTimes(1)
  })
})
