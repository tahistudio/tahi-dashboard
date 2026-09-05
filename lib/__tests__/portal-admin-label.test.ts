import { describe, it, expect } from 'vitest'
import {
  portalAdminLabel,
  portalMoneyDenial,
  portalInvoiceDenialCopy,
  PORTAL_ADMIN_FALLBACK_LABEL,
} from '@/lib/portal-admin-label'

/**
 * CT.6. A client member seat is refused /api/portal/invoices by design, so the
 * page tells them who to ask instead of showing them a failure. This helper
 * turns the org roster into that name, and must never leave the sentence
 * dangling when it cannot find one.
 */

describe('portalAdminLabel', () => {
  it('falls back when the roster is missing, empty, or holds no admin', () => {
    expect(portalAdminLabel(null)).toBe(PORTAL_ADMIN_FALLBACK_LABEL)
    expect(portalAdminLabel(undefined)).toBe(PORTAL_ADMIN_FALLBACK_LABEL)
    expect(portalAdminLabel([])).toBe(PORTAL_ADMIN_FALLBACK_LABEL)
    expect(portalAdminLabel([
      { name: 'Dee', portalRole: 'member', isPrimary: false },
    ])).toBe(PORTAL_ADMIN_FALLBACK_LABEL)
  })

  it('names an explicit admin', () => {
    expect(portalAdminLabel([
      { name: 'Dee', portalRole: 'member', isPrimary: false },
      { name: 'Ana', portalRole: 'admin', isPrimary: false },
    ])).toBe('Ana')
  })

  it('names the primary contact even when portalRole defaulted to member', () => {
    // The admin client-create and self-serve provision flows both insert the
    // primary contact without a portalRole, so the owner reads as 'member'
    // here while the server still treats them as an admin.
    expect(portalAdminLabel([
      { name: 'Ana', portalRole: 'member', isPrimary: true },
    ])).toBe('Ana')
    expect(portalAdminLabel([
      { name: 'Ana', portalRole: null, isPrimary: 1 },
    ])).toBe('Ana')
  })

  it('joins two names with or, and three with commas plus or', () => {
    expect(portalAdminLabel([
      { name: 'Ana', portalRole: 'admin' },
      { name: 'Ben', portalRole: 'admin' },
    ])).toBe('Ana or Ben')
    expect(portalAdminLabel([
      { name: 'Ana', portalRole: 'admin' },
      { name: 'Ben', portalRole: 'admin' },
      { name: 'Cara', portalRole: 'admin' },
    ])).toBe('Ana, Ben or Cara')
  })

  it('caps at three names so the copy stays a sentence', () => {
    expect(portalAdminLabel([
      { name: 'Ana', portalRole: 'admin' },
      { name: 'Ben', portalRole: 'admin' },
      { name: 'Cara', portalRole: 'admin' },
      { name: 'Dan', portalRole: 'admin' },
    ])).toBe('Ana, Ben or Cara')
  })

  it('skips pending invites, blank names and duplicates', () => {
    expect(portalAdminLabel([
      { name: 'Zoe', portalRole: 'admin', pending: true },
      { name: '   ', portalRole: 'admin' },
      { name: null, portalRole: 'admin' },
      { name: ' Ana ', portalRole: 'admin' },
      { name: 'Ana', portalRole: 'admin', isPrimary: true },
    ])).toBe('Ana')
  })
})

/**
 * CT.6 review follow-up. /api/portal/invoices answers 403 for four different
 * reasons and, today, three of them share the bare `{ error: 'Forbidden' }`
 * body. Telling an org admin whose workspace has billing switched off to "ask
 * your organisation admin" is a lie, so the page classifies the denial first.
 * The classifier stays backward compatible: an unknown or absent code reads as
 * the member seat, which is what it means on the routes as they stand.
 */

describe('portalMoneyDenial', () => {
  it('reads a bare Forbidden body as the member seat', () => {
    expect(portalMoneyDenial({ error: 'Forbidden' })).toBe('member_seat')
  })

  it('reads a missing, empty or non-object body as the member seat', () => {
    expect(portalMoneyDenial(undefined)).toBe('member_seat')
    expect(portalMoneyDenial(null)).toBe('member_seat')
    expect(portalMoneyDenial('Forbidden')).toBe('member_seat')
    expect(portalMoneyDenial({})).toBe('member_seat')
  })

  it('reads the unlinked-account body the routes already send today', () => {
    // app/api/portal/invoices/route.ts and its [id] sibling both answer this
    // exact string when getPortalAuth resolved no D1 org, so this branch works
    // before anyone adds a machine-readable code.
    expect(portalMoneyDenial({ error: 'No organisation found for this user' }))
      .toBe('no_org')
  })

  it('prefers an explicit code once the routes carry one', () => {
    expect(portalMoneyDenial({ error: 'Forbidden', code: 'feature_disabled' }))
      .toBe('feature_disabled')
    expect(portalMoneyDenial({ error: 'Forbidden', code: 'not_org_admin' }))
      .toBe('member_seat')
    expect(portalMoneyDenial({ error: 'Forbidden', code: 'no_org' })).toBe('no_org')
  })

  it('falls back to the member seat on a code it does not know', () => {
    expect(portalMoneyDenial({ error: 'Forbidden', code: 'something_new' }))
      .toBe('member_seat')
    expect(portalMoneyDenial({ error: 'Forbidden', code: 42 })).toBe('member_seat')
  })
})

describe('portalInvoiceDenialCopy', () => {
  it('names who to ask for a member seat', () => {
    const copy = portalInvoiceDenialCopy('member_seat', 'Ana')
    expect(copy.title).toBe('Invoices are visible to your organisation admin')
    expect(copy.description).toContain('Ask Ana if you need one')
  })

  it('never blames the reader when the whole workspace is switched off', () => {
    const copy = portalInvoiceDenialCopy('feature_disabled', 'Ana')
    expect(copy.title).toBe('Billing is switched off for your workspace')
    // The org admin IS the reader in this case, so naming them would be absurd.
    expect(copy.description).not.toContain('Ana')
    expect(copy.description).toContain('Tahi Studio')
  })

  it('points an unlinked login at the studio, not at their own org', () => {
    const copy = portalInvoiceDenialCopy('no_org', 'Ana')
    expect(copy.title).toBe('Your login is not linked to a workspace yet')
    expect(copy.description).not.toContain('Ana')
    expect(copy.description).toContain('Tahi Studio')
  })

  it('reassures every seat that the rest of the portal still works', () => {
    for (const denial of ['member_seat', 'feature_disabled', 'no_org'] as const) {
      expect(portalInvoiceDenialCopy(denial, 'Ana').description)
        .toContain('requests, files and services are unaffected')
    }
  })
})
