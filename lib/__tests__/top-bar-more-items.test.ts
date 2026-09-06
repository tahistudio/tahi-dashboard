/**
 * The mobile More sheet is the only place a phone can reach theme, settings
 * and sign out, so what it offers is worth pinning down. The currency row in
 * particular has to disappear for a client audience the same way the desktop
 * chip does, or a client gets a control that offers to re-denominate their own
 * invoices into a number nobody will bill.
 */
import { describe, it, expect } from 'vitest'
import { buildMoreSections, moreSheetItemIds } from '@/lib/top-bar-more-items'

describe('buildMoreSections', () => {
  it('gives a studio session its tools', () => {
    const ids = moreSheetItemIds({ showAsAdmin: true, isSuperAdmin: false })
    expect(ids).toContain('timer')
    expect(ids).toContain('brief')
  })

  it('keeps studio tools away from a client audience', () => {
    const ids = moreSheetItemIds({ showAsAdmin: false, isSuperAdmin: false })
    expect(ids).not.toContain('timer')
    expect(ids).not.toContain('brief')
    // Preferences and Account still render: this is the only route to them.
    expect(ids).toContain('theme')
    expect(ids).toContain('settings')
    expect(ids).toContain('signOut')
  })

  it('drops the currency row when the session is pinned', () => {
    const ids = moreSheetItemIds({
      showAsAdmin: false, isSuperAdmin: false, currencyPinned: true,
    })
    expect(ids).not.toContain('currency')
    expect(ids).toContain('theme')
  })

  it('keeps the currency row for an unpinned studio session', () => {
    const ids = moreSheetItemIds({ showAsAdmin: true, isSuperAdmin: false })
    expect(ids).toContain('currency')
  })

  it('never leaves a section with a heading and no rows', () => {
    for (const currencyPinned of [true, false]) {
      for (const showAsAdmin of [true, false]) {
        const sections = buildMoreSections({
          showAsAdmin, isSuperAdmin: false, currencyPinned,
        })
        for (const section of sections) expect(section.items.length).toBeGreaterThan(0)
      }
    }
  })

  it('gates the preview controls on super admin', () => {
    expect(moreSheetItemIds({ showAsAdmin: true, isSuperAdmin: false }))
      .not.toContain('clientView')
    expect(moreSheetItemIds({ showAsAdmin: true, isSuperAdmin: true }))
      .toContain('clientView')
  })
})
