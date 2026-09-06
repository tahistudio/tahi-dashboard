import { describe, it, expect } from 'vitest'
import {
  resolveWorkspaceChoice,
  resolveNoOrgRedirect,
  safeNextPath,
  type WorkspaceMembership,
} from '@/lib/workspace-choice'

const TAHI = 'org_tahi'
const CLIENT_A = 'org_client_a'
const CLIENT_B = 'org_client_b'

const m = (organizationId: string, name = organizationId): WorkspaceMembership => ({
  organizationId,
  name,
  role: 'org:member',
})

describe('resolveWorkspaceChoice', () => {
  it('redirects when the session already has an active org', () => {
    expect(
      resolveWorkspaceChoice({ activeOrgId: CLIENT_A, memberships: [], tahiOrgId: TAHI }),
    ).toEqual({ action: 'redirect' })
  })

  it('sends a user with no memberships to onboarding (a genuine lead)', () => {
    expect(
      resolveWorkspaceChoice({ activeOrgId: null, memberships: [], tahiOrgId: TAHI }),
    ).toEqual({ action: 'onboarding' })
  })

  it('activates the Tahi org for a teammate, even alongside client orgs', () => {
    expect(
      resolveWorkspaceChoice({
        activeOrgId: null,
        memberships: [m(CLIENT_A), m(TAHI), m(CLIENT_B)],
        tahiOrgId: TAHI,
      }),
    ).toEqual({ action: 'activate', organizationId: TAHI })
  })

  it('activates the Tahi org when it is the only membership (the reported bug)', () => {
    expect(
      resolveWorkspaceChoice({
        activeOrgId: null,
        memberships: [m(TAHI, 'Tahi Studio')],
        tahiOrgId: TAHI,
      }),
    ).toEqual({ action: 'activate', organizationId: TAHI })
  })

  it('activates the single membership of a client seat', () => {
    expect(
      resolveWorkspaceChoice({
        activeOrgId: null,
        memberships: [m(CLIENT_A, 'Giant Group')],
        tahiOrgId: TAHI,
      }),
    ).toEqual({ action: 'activate', organizationId: CLIENT_A })
  })

  it('asks when there are several client orgs and no Tahi membership', () => {
    expect(
      resolveWorkspaceChoice({
        activeOrgId: null,
        memberships: [m(CLIENT_A), m(CLIENT_B)],
        tahiOrgId: TAHI,
      }),
    ).toEqual({ action: 'pick' })
  })

  it('falls back to the single-membership rule when the Tahi org id is unset', () => {
    expect(
      resolveWorkspaceChoice({ activeOrgId: null, memberships: [m(TAHI)], tahiOrgId: null }),
    ).toEqual({ action: 'activate', organizationId: TAHI })
    expect(
      resolveWorkspaceChoice({
        activeOrgId: null,
        memberships: [m(TAHI), m(CLIENT_A)],
        tahiOrgId: undefined,
      }),
    ).toEqual({ action: 'pick' })
  })
})

describe('safeNextPath', () => {
  it('keeps a same-origin path', () => {
    expect(safeNextPath('/requests?status=active')).toBe('/requests?status=active')
  })

  it('rejects absolute, protocol-relative and backslash forms', () => {
    expect(safeNextPath('https://evil.com')).toBe('/overview')
    expect(safeNextPath('//evil.com')).toBe('/overview')
    expect(safeNextPath('/\\evil.com')).toBe('/overview')
  })

  it('never points back at the chooser', () => {
    expect(safeNextPath('/choose-workspace?next=/x')).toBe('/overview')
  })

  it('defaults an empty value', () => {
    expect(safeNextPath(null)).toBe('/overview')
    expect(safeNextPath(undefined)).toBe('/overview')
    expect(safeNextPath('')).toBe('/overview')
  })
})

describe('resolveNoOrgRedirect', () => {
  it('sends a no-org session on /overview to the chooser, carrying next', () => {
    expect(resolveNoOrgRedirect('/overview')).toBe('/choose-workspace?next=%2Foverview')
  })

  it('preserves the query string of the original location', () => {
    expect(resolveNoOrgRedirect('/requests', '?status=active')).toBe(
      '/choose-workspace?next=%2Frequests%3Fstatus%3Dactive',
    )
  })

  it('lets the onboarding, welcome and chooser paths through', () => {
    expect(resolveNoOrgRedirect('/onboarding')).toBeNull()
    expect(resolveNoOrgRedirect('/welcome')).toBeNull()
    expect(resolveNoOrgRedirect('/choose-workspace')).toBeNull()
  })

  it('leaves API routes alone (they self-guard)', () => {
    expect(resolveNoOrgRedirect('/api/portal/requests')).toBeNull()
  })
})
