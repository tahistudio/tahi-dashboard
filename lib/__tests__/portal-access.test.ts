/**
 * Unit tests for lib/portal-access.ts, the one place the portal decides
 * "is this client person an admin of their own workspace?".
 *
 * Both sides of the portal ask it: the financial reads (invoices, subscription,
 * checkout, billing session) and every write path (brands, organisation,
 * people, invites, retainer change requests). The truth table below is the
 * contract those routes share.
 *
 * The primary-contact clause is load bearing, not a courtesy: contacts
 * .portal_role is NOT NULL DEFAULT 'member', so a freshly provisioned owner
 * reads 'member' with is_primary = 1. Testing the column alone locks the owner
 * out of their own workspace.
 */
import { describe, it, expect, vi } from 'vitest'

interface Op { op: string; col?: unknown; val?: unknown; parts?: unknown[] }

// The predicate is built by lib/portal-identity.ts, so the shape assertions
// below need the operators and the columns to be inspectable.
vi.mock('@/db/d1', () => ({
  schema: {
    contacts: {
      id: 'contacts.id',
      orgId: 'contacts.orgId',
      clerkUserId: 'contacts.clerkUserId',
      isPrimary: 'contacts.isPrimary',
      portalRole: 'contacts.portalRole',
    },
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown): Op => ({ op: 'eq', col, val }),
  desc: (col: unknown): Op => ({ op: 'desc', col }),
  and: (...parts: unknown[]): Op => ({ op: 'and', parts }),
}))

import { isPortalAdminContact, resolvePortalRole, isOrgAdmin } from '@/lib/portal-access'

type Row = Record<string, unknown>

const lastWhere: { value: unknown } = { value: undefined }

function fakeDb(rows: Row[]): Parameters<typeof isOrgAdmin>[0] {
  const chain = {
    from: () => chain,
    where: (w: unknown) => {
      lastWhere.value = w
      return chain
    },
    limit: () => Promise.resolve(rows),
  }
  return { select: () => chain } as unknown as Parameters<typeof isOrgAdmin>[0]
}

function wherePartsOfLastCall(): Op[] {
  return ((lastWhere.value as Op)?.parts ?? []) as Op[]
}

describe('isPortalAdminContact', () => {
  it('accepts an explicit admin portalRole', () => {
    expect(isPortalAdminContact({ portalRole: 'admin', isPrimary: false })).toBe(true)
    expect(isPortalAdminContact({ portalRole: 'admin', isPrimary: null })).toBe(true)
    expect(isPortalAdminContact({ portalRole: 'admin', isPrimary: true })).toBe(true)
  })

  it('accepts the primary contact whose role column never moved off the default', () => {
    // Provision + admin client-create historically inserted primary contacts
    // without naming a role, and the column defaults to 'member'. The owner
    // must not be locked out of their own invoices, teammates or org settings.
    expect(isPortalAdminContact({ portalRole: 'member', isPrimary: true })).toBe(true)
    expect(isPortalAdminContact({ portalRole: 'member', isPrimary: 1 })).toBe(true)
    expect(isPortalAdminContact({ portalRole: null, isPrimary: true })).toBe(true)
    expect(isPortalAdminContact({ portalRole: '', isPrimary: 1 })).toBe(true)
  })

  it('denies plain member seats', () => {
    expect(isPortalAdminContact({ portalRole: 'member', isPrimary: false })).toBe(false)
    expect(isPortalAdminContact({ portalRole: 'member', isPrimary: 0 })).toBe(false)
    expect(isPortalAdminContact({ portalRole: null, isPrimary: null })).toBe(false)
    expect(isPortalAdminContact({ portalRole: '', isPrimary: 0 })).toBe(false)
  })

  it('denies when there is no contact row at all', () => {
    expect(isPortalAdminContact(undefined)).toBe(false)
    expect(isPortalAdminContact(null)).toBe(false)
  })
})

describe('resolvePortalRole', () => {
  it('states the same decision as the role the portal acts on', () => {
    expect(resolvePortalRole({ portalRole: 'admin', isPrimary: false })).toBe('admin')
    expect(resolvePortalRole({ portalRole: 'member', isPrimary: true })).toBe('admin')
    expect(resolvePortalRole({ portalRole: 'member', isPrimary: false })).toBe('member')
    expect(resolvePortalRole(null)).toBe('member')
    expect(resolvePortalRole(undefined)).toBe('member')
  })
})

describe('isOrgAdmin', () => {
  it('resolves the contact row and applies the admin decision', async () => {
    expect(await isOrgAdmin(fakeDb([{ portalRole: 'admin', isPrimary: false }]), 'org_1', 'user_1')).toBe(true)
    expect(await isOrgAdmin(fakeDb([{ portalRole: 'member', isPrimary: true }]), 'org_1', 'user_1')).toBe(true)
    expect(await isOrgAdmin(fakeDb([{ portalRole: 'member', isPrimary: false }]), 'org_1', 'user_1')).toBe(false)
    expect(await isOrgAdmin(fakeDb([]), 'org_1', 'user_1')).toBe(false)
  })

  it('matches the caller by login when no preview seat is named', async () => {
    // Every existing caller passes three arguments, so this is the predicate
    // the helper has always carried. The seat is opt-in, per call site.
    await isOrgAdmin(fakeDb([]), 'org_1', 'user_1')
    expect(wherePartsOfLastCall()).toEqual([
      { op: 'eq', col: 'contacts.orgId', val: 'org_1' },
      { op: 'eq', col: 'contacts.clerkUserId', val: 'user_1' },
    ])
  })

  it('asks about the previewed seat when one is named', async () => {
    // In Client view the Clerk id belongs to the operator and no client org
    // holds a row for it, so this answered false for every workspace. Asking
    // about the seat asks about the person being previewed.
    expect(
      await isOrgAdmin(
        fakeDb([{ portalRole: 'member', isPrimary: true }]),
        'org_1',
        'user_liam',
        'contact_primary',
      ),
    ).toBe(true)
    expect(wherePartsOfLastCall()).toEqual([
      { op: 'eq', col: 'contacts.orgId', val: 'org_1' },
      { op: 'eq', col: 'contacts.id', val: 'contact_primary' },
    ])
  })

  it('still answers for the seat, not for the preview: a member seat is denied', async () => {
    expect(
      await isOrgAdmin(
        fakeDb([{ portalRole: 'member', isPrimary: false }]),
        'org_1',
        'user_liam',
        'contact_member',
      ),
    ).toBe(false)
  })
})
