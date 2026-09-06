/**
 * Who the onboarding screen tells a client their studio lead is.
 *
 * app/(onboarding)/onboarding/page.tsx hardcoded "Liam Miller" for every client
 * on the one screen whose job is to make the engagement feel personally held.
 * The line was marked SEAM in the source, so this is that seam closing.
 *
 * The order is the whole behaviour, and it is what this file pins: the org's
 * assigned project_manager (the same `team_member_access` record the client
 * detail page reads and the MCP `assign_client_pm` tool writes), then the first
 * super_admin on the roster, then the literal that was there before, so an
 * unseeded environment renders exactly what it rendered before rather than a
 * nameless card.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STUDIO_LEAD,
  initialsFor,
  leadFromCandidate,
  resolveStudioLead,
  STUDIO_LEAD_ROLE,
  type StudioLeadCandidate,
  type StudioLeadDeps,
} from '@/lib/onboarding-lead'

const PM: StudioLeadCandidate = {
  id: 'tm_pm', name: 'Staci Bonnie', email: 'staci@tahi.studio', avatarUrl: 'https://cdn/staci.jpg',
}
const OWNER: StudioLeadCandidate = {
  id: 'tm_owner', name: 'Liam Miller', email: 'business@tahi.studio', avatarUrl: null,
}

function deps(over: Partial<StudioLeadDeps> = {}): StudioLeadDeps {
  return {
    findPmForOrg: () => Promise.resolve(null),
    findFirstSuperAdmin: () => Promise.resolve(null),
    ...over,
  }
}

describe('resolveStudioLead', () => {
  it('names the org assigned PM when there is one', async () => {
    const lead = await resolveStudioLead(deps({
      findPmForOrg: () => Promise.resolve(PM),
      findFirstSuperAdmin: () => Promise.resolve(OWNER),
    }), 'org_acme')

    expect(lead).toEqual({
      name: 'Staci Bonnie',
      first: 'Staci',
      role: STUDIO_LEAD_ROLE,
      initials: 'SB',
      img: 'https://cdn/staci.jpg',
    })
  })

  it('falls back to the first super_admin when the org has no PM', async () => {
    const lead = await resolveStudioLead(deps({
      findFirstSuperAdmin: () => Promise.resolve(OWNER),
    }), 'org_acme')

    expect(lead.name).toBe('Liam Miller')
    expect(lead.initials).toBe('LM')
    // No avatarUrl on the row, but the local studio portrait still resolves, so
    // the card does not silently downgrade to initials.
    expect(lead.img).toBe('/liam-profile.jpg')
  })

  it('skips the PM lookup entirely for a client with no workspace yet', async () => {
    let pmCalls = 0
    const lead = await resolveStudioLead(deps({
      findPmForOrg: () => { pmCalls++; return Promise.resolve(PM) },
      findFirstSuperAdmin: () => Promise.resolve(OWNER),
    }), null)

    expect(pmCalls).toBe(0)
    expect(lead.name).toBe('Liam Miller')
  })

  it('falls back to the literal when the roster is empty (unseeded environment)', async () => {
    expect(await resolveStudioLead(deps(), 'org_acme')).toEqual(DEFAULT_STUDIO_LEAD)
  })

  it('degrades one step at a time when a lookup throws, never breaking the screen', async () => {
    const lead = await resolveStudioLead(deps({
      findPmForOrg: () => Promise.reject(new Error('d1 down')),
      findFirstSuperAdmin: () => Promise.resolve(OWNER),
    }), 'org_acme')
    expect(lead.name).toBe('Liam Miller')

    const last = await resolveStudioLead(deps({
      findPmForOrg: () => Promise.reject(new Error('d1 down')),
      findFirstSuperAdmin: () => Promise.reject(new Error('d1 down')),
    }), 'org_acme')
    expect(last).toEqual(DEFAULT_STUDIO_LEAD)
  })

  it('keeps the label the screen already showed', async () => {
    const lead = await resolveStudioLead(deps({ findFirstSuperAdmin: () => Promise.resolve(PM) }), null)
    expect(lead.role).toBe(DEFAULT_STUDIO_LEAD.role)
  })
})

describe('leadFromCandidate', () => {
  it('derives initials from the first two words and falls back on a single name', () => {
    expect(initialsFor('Liam Miller')).toBe('LM')
    expect(initialsFor('Nathan')).toBe('N')
    expect(initialsFor('  ana maria de souza ')).toBe('AM')
    expect(initialsFor('')).toBe('?')
  })

  it('uses the email when a roster row has a blank name', () => {
    const lead = leadFromCandidate({ id: 'tm_x', name: '   ', email: 'nathan@tahi.studio', avatarUrl: null })
    expect(lead.name).toBe('nathan@tahi.studio')
    expect(lead.img).toBeUndefined()
  })

  it('prefers an uploaded avatar over the local studio portrait', () => {
    const lead = leadFromCandidate({ ...OWNER, avatarUrl: 'https://cdn/liam.png' })
    expect(lead.img).toBe('https://cdn/liam.png')
  })
})
