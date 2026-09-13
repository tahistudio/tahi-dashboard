/**
 * The client rail never offers /billing (CT.16, Liam's default when silent:
 * out of the client nav, reachable only by URL or from the client home's
 * Billing zone). This pins the decision down in code so a future nav edit
 * cannot reintroduce the item by accident.
 */

import { describe, it, expect } from 'vitest'
import { ADMIN_NAV, CLIENT_NAV, filterNav, type FilterNavOpts } from '../nav-model'

function allHrefs(groups: { items: { href: string }[] }[]): string[] {
  return groups.flatMap(g => g.items.map(item => item.href))
}

const BASE_CLIENT_OPTS: FilterNavOpts = {
  showAsAdmin: false,
  isEffectiveAdmin: false,
  isViewerRole: false,
  userEmail: null,
  canManagePermissions: false,
}

describe('CLIENT_NAV excludes /billing', () => {
  it('carries no /billing entry in the raw model', () => {
    expect(allHrefs(CLIENT_NAV)).not.toContain('/billing')
  })

  it('carries no /billing entry after filterNav, for a member or an org admin seat', () => {
    for (const clientPortalRole of ['admin', 'member', null] as const) {
      const filtered = filterNav(CLIENT_NAV, { ...BASE_CLIENT_OPTS, clientPortalRole })
      expect(allHrefs(filtered)).not.toContain('/billing')
    }
  })

  it('keeps the Billing group to Invoices only, so the route stays reachable by URL and from the client home, never from the rail', () => {
    const billingGroup = CLIENT_NAV.find(g => g.group === 'Billing')
    expect(billingGroup).toBeDefined()
    expect(billingGroup?.items.map(i => i.href)).toEqual(['/invoices'])
  })
})

describe('ADMIN_NAV still carries /billing, adminOnly', () => {
  it('is present for the studio and gated behind isEffectiveAdmin', () => {
    const billing = ADMIN_NAV.flatMap(g => g.items).find(i => i.href === '/billing')
    expect(billing).toBeDefined()
    expect(billing?.adminOnly).toBe(true)
  })

  it('drops out of filterNav for a scoped team member (not an effective admin)', () => {
    const filtered = filterNav(ADMIN_NAV, {
      showAsAdmin: true,
      isEffectiveAdmin: false,
      isViewerRole: false,
      userEmail: null,
      canManagePermissions: false,
    })
    expect(allHrefs(filtered)).not.toContain('/billing')
  })

  it('is offered to an effective admin', () => {
    const filtered = filterNav(ADMIN_NAV, {
      showAsAdmin: true,
      isEffectiveAdmin: true,
      isViewerRole: false,
      userEmail: null,
      canManagePermissions: false,
    })
    expect(allHrefs(filtered)).toContain('/billing')
  })
})
