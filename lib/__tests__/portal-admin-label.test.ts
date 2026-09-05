import { describe, it, expect } from 'vitest'
import { portalAdminLabel, PORTAL_ADMIN_FALLBACK_LABEL } from '@/lib/portal-admin-label'

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
