import { describe, it, expect } from 'vitest'
import { buildMoreSections, moreSheetItemIds } from './top-bar-more-items'

describe('buildMoreSections', () => {
  it('gives a studio session the tools the mobile bar drops', () => {
    const ids = moreSheetItemIds({ showAsAdmin: true, isSuperAdmin: false })
    expect(ids).toContain('timer')
    expect(ids).toContain('brief')
    expect(ids).toContain('currency')
  })

  it('hides studio-only tools from a client portal session', () => {
    const ids = moreSheetItemIds({ showAsAdmin: false, isSuperAdmin: false })
    expect(ids).not.toContain('timer')
    expect(ids).not.toContain('brief')
  })

  it('drops the empty Tools section rather than rendering a bare heading', () => {
    const sections = buildMoreSections({ showAsAdmin: false, isSuperAdmin: false })
    expect(sections.map(s => s.id)).toEqual(['preferences', 'account'])
  })

  it('keeps theme, settings and sign out reachable for every audience', () => {
    for (const showAsAdmin of [true, false]) {
      const ids = moreSheetItemIds({ showAsAdmin, isSuperAdmin: false })
      expect(ids).toContain('theme')
      expect(ids).toContain('settings')
      expect(ids).toContain('signOut')
    }
  })

  it('gates private mode and client view on super admin', () => {
    const plain = moreSheetItemIds({ showAsAdmin: true, isSuperAdmin: false })
    expect(plain).not.toContain('privateMode')
    expect(plain).not.toContain('clientView')

    const superAdmin = moreSheetItemIds({ showAsAdmin: true, isSuperAdmin: true })
    expect(superAdmin).toContain('privateMode')
    expect(superAdmin).toContain('clientView')
  })

  it('never repeats an item across sections', () => {
    const ids = moreSheetItemIds({ showAsAdmin: true, isSuperAdmin: true })
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('orders the sections tools, preferences, account', () => {
    const sections = buildMoreSections({ showAsAdmin: true, isSuperAdmin: true })
    expect(sections.map(s => s.id)).toEqual(['tools', 'preferences', 'account'])
  })
})
