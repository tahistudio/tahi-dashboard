import { describe, it, expect } from 'vitest'
import type { QaScanResult } from '@/lib/qa/types'
import { browserBreakdown, emptyTicks, pageRowTitle, scansForBrowser, tickCount, ticksFor, type QaRoundPageRow } from '../qa-types'
import { applyPagePatch, rollbackTickPatch } from '../use-round'

function row(over: Partial<QaRoundPageRow> = {}): QaRoundPageRow {
  return {
    id: 'rp1', roundId: 'r1', pageId: 'p1', path: '/pricing', groupKey: null, sortOrder: 0,
    vpXl: 0, vpDesktop: 0, vpTablet: 0, vpMobileL: 0, vpMobileP: 0,
    status: 'untested', note: null, requestIds: null,
    a11yCritical: null, a11ySerious: null, a11yModerate: null, a11yMinor: null,
    brokenLinks: null, seoIssues: null, launchIssues: null, perfIssues: null,
    scannedAt: null, pagespeed: null, pagespeedAt: null,
    ...over,
  }
}

const scan = {} as QaScanResult

describe('ticks per browser', () => {
  it('reads Chrome from the vp columns when the row has no browserTicks, and other browsers as empty', () => {
    const r = row({ vpXl: 1, vpMobileP: 1 })
    expect(ticksFor(r)).toEqual({ xl: true, desktop: false, tablet: false, mobile_l: false, mobile_p: true })
    expect(ticksFor(r, 'firefox')).toEqual(emptyTicks())
  })

  it('prefers the browserTicks the server sent', () => {
    const r = row({
      vpXl: 1,
      browserTicks: {
        chromium: { ...emptyTicks(), xl: true },
        firefox: { ...emptyTicks(), tablet: true, mobile_l: true },
      },
    })
    expect(ticksFor(r, 'firefox')).toEqual({ xl: false, desktop: false, tablet: true, mobile_l: true, mobile_p: false })
  })

  it('tickCount counts across the given browsers and defaults to Chrome', () => {
    const r = row({
      vpXl: 1, vpDesktop: 1,
      browserTicks: { chromium: { ...emptyTicks(), xl: true, desktop: true }, firefox: { ...emptyTicks(), tablet: true } },
    })
    expect(tickCount(r)).toBe(2)
    expect(tickCount(r, ['chromium', 'firefox'])).toBe(3)
    expect(tickCount(r, ['webkit'])).toBe(0)
  })

  it('breaks a page down per browser, in the round order, for the row tooltip', () => {
    const r = row({
      browserTicks: { chromium: { ...emptyTicks(), xl: true, desktop: true, tablet: true }, firefox: emptyTicks() },
    })
    expect(browserBreakdown(r, ['chromium', 'firefox']).map(b => `${b.label} ${b.done}/${b.total}`)).toEqual(['Chrome 3/5', 'Firefox 0/5'])
    expect(pageRowTitle(r, ['chromium', 'firefox'])).toBe('/pricing. Chrome 3/5, Firefox 0/5')
    expect(pageRowTitle(r, ['chromium'])).toBe('/pricing')
  })
})

describe('applyPagePatch with a browser', () => {
  it('a Chrome tick updates the vp column and the Chrome browserTicks', () => {
    const next = applyPagePatch(row(), { vp: { desktop: true } })
    expect(next.vpDesktop).toBe(1)
    expect(next.browserTicks?.chromium?.desktop).toBe(true)
  })

  it('a Firefox tick leaves the vp columns and the Chrome ticks alone', () => {
    const start = row({ vpXl: 1, browserTicks: { chromium: { ...emptyTicks(), xl: true }, firefox: emptyTicks() } })
    const next = applyPagePatch(start, { vp: { tablet: true }, browser: 'firefox' })
    expect(next.vpTablet).toBe(0)
    expect(next.vpXl).toBe(1)
    expect(next.browserTicks?.firefox?.tablet).toBe(true)
    expect(next.browserTicks?.chromium?.xl).toBe(true)
    expect(start.browserTicks?.firefox?.tablet).toBe(false)
  })

  it('un-ticking works and a status patch leaves the ticks untouched', () => {
    const ticked = row({ browserTicks: { firefox: { ...emptyTicks(), desktop: true } } })
    expect(applyPagePatch(ticked, { vp: { desktop: false }, browser: 'firefox' }).browserTicks?.firefox?.desktop).toBe(false)
    const status = applyPagePatch(ticked, { status: 'pass' })
    expect(status.status).toBe('pass')
    expect(status.browserTicks).toBe(ticked.browserTicks)
  })
})

describe('scansForBrowser', () => {
  const scans = { chromium: { desktop: scan }, webkit: { tablet: scan } }

  it('returns the scans of the browser asked for, and nothing for a browser with none', () => {
    expect(scansForBrowser(scans, 'chromium')).toEqual({ desktop: scan })
    expect(scansForBrowser(scans, 'firefox')).toEqual({})
  })

  it('falls back to the first browser that has scans when asked to', () => {
    expect(scansForBrowser(scans, 'firefox', true)).toEqual({ desktop: scan })
    expect(scansForBrowser({ webkit: { tablet: scan } }, 'firefox', true)).toEqual({ tablet: scan })
    expect(scansForBrowser({}, 'firefox', true)).toEqual({})
  })
})

describe('rollbackTickPatch', () => {
  it('tick A then B with A failing keeps B ticked', () => {
    const start = row({ browserTicks: { firefox: emptyTicks() } })
    const a = { vp: { desktop: true }, browser: 'firefox' as const }
    const b = { vp: { tablet: true }, browser: 'firefox' as const }
    const afterA = applyPagePatch(start, a)
    const afterB = applyPagePatch(afterA, b)
    const rolled = rollbackTickPatch(afterB.browserTicks, start, afterA, a)
    expect(rolled?.firefox?.desktop).toBe(false)
    expect(rolled?.firefox?.tablet).toBe(true)
  })

  it('leaves a viewport alone when something newer changed it', () => {
    const start = row({ browserTicks: { firefox: emptyTicks() } })
    const a = { vp: { desktop: true }, browser: 'firefox' as const }
    const afterA = applyPagePatch(start, a)
    const untick = applyPagePatch(afterA, { vp: { desktop: false }, browser: 'firefox' })
    expect(rollbackTickPatch(untick.browserTicks, start, afterA, a)?.firefox?.desktop).toBe(false)
    const reTick = applyPagePatch(untick, { vp: { desktop: true }, browser: 'firefox' })
    expect(rollbackTickPatch(reTick.browserTicks, untick, reTick, { vp: { desktop: true }, browser: 'firefox' })?.firefox?.desktop).toBe(false)
  })
})
