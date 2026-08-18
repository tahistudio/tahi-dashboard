/**
 * Unit tests for lib/portal-access.ts.
 *
 * Financial portal routes gate on isOrgAdmin. The decision must treat
 * portalRole === 'admin' as admin, treat the org's primary contact as admin
 * (fallback: the provision + admin client-create flows insert primary
 * contacts without a portalRole, so it defaults to 'member'), and deny
 * member seats and callers with no contact row.
 */
import { describe, it, expect } from 'vitest'
import { isPortalAdminContact, isOrgAdmin } from '@/lib/portal-access'

type Row = Record<string, unknown>

function fakeDb(rows: Row[]): Parameters<typeof isOrgAdmin>[0] {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  }
  return { select: () => chain } as unknown as Parameters<typeof isOrgAdmin>[0]
}

describe('isPortalAdminContact', () => {
  it('accepts an explicit admin portalRole', () => {
    expect(isPortalAdminContact({ portalRole: 'admin', isPrimary: false })).toBe(true)
    expect(isPortalAdminContact({ portalRole: 'admin', isPrimary: null })).toBe(true)
  })

  it('accepts the primary contact even when portalRole defaulted to member', () => {
    // Provision + admin client-create insert primary contacts without a
    // portalRole; the owner must not be locked out of their own invoices.
    expect(isPortalAdminContact({ portalRole: 'member', isPrimary: true })).toBe(true)
    expect(isPortalAdminContact({ portalRole: 'member', isPrimary: 1 })).toBe(true)
  })

  it('denies plain member seats', () => {
    expect(isPortalAdminContact({ portalRole: 'member', isPrimary: false })).toBe(false)
    expect(isPortalAdminContact({ portalRole: 'member', isPrimary: 0 })).toBe(false)
    expect(isPortalAdminContact({ portalRole: null, isPrimary: null })).toBe(false)
  })

  it('denies when there is no contact row at all', () => {
    expect(isPortalAdminContact(undefined)).toBe(false)
    expect(isPortalAdminContact(null)).toBe(false)
  })
})

describe('isOrgAdmin', () => {
  it('resolves the contact row and applies the admin decision', async () => {
    expect(await isOrgAdmin(fakeDb([{ portalRole: 'admin', isPrimary: false }]), 'org_1', 'user_1')).toBe(true)
    expect(await isOrgAdmin(fakeDb([{ portalRole: 'member', isPrimary: true }]), 'org_1', 'user_1')).toBe(true)
    expect(await isOrgAdmin(fakeDb([{ portalRole: 'member', isPrimary: false }]), 'org_1', 'user_1')).toBe(false)
    expect(await isOrgAdmin(fakeDb([]), 'org_1', 'user_1')).toBe(false)
  })
})
