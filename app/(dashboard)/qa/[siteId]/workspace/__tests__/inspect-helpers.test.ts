import { describe, expect, it } from 'vitest'
import { QA_VIEWPORTS } from '@/lib/qa/types'
import {
  DEFAULT_INSPECT_DEVICE,
  DEFAULT_VIEW_MODE,
  TOKEN_FRESH_MARGIN_MS,
  VIEW_MODE_STORAGE_KEY,
  inspectDeviceOptions,
  inspectOverflows,
  inspectScrollStep,
  isTokenFresh,
  parseViewMode,
  parseViewportKey,
  showsSingleFrame,
  viewAtFullSizeUrl,
} from '../inspect-helpers'

describe('parseViewMode', () => {
  it('defaults to Inspect for a round that has never chosen', () => {
    expect(DEFAULT_VIEW_MODE).toBe('inspect')
    expect(parseViewMode(null)).toBe('inspect')
    expect(parseViewMode(undefined)).toBe('inspect')
    expect(parseViewMode('')).toBe('inspect')
  })

  it('keeps a saved choice of either mode', () => {
    expect(parseViewMode('overview')).toBe('overview')
    expect(parseViewMode('inspect')).toBe('inspect')
  })

  it('falls back to Inspect for anything unreadable', () => {
    expect(parseViewMode('Overview')).toBe('inspect')
    expect(parseViewMode('zoom')).toBe('inspect')
    expect(parseViewMode(3)).toBe('inspect')
    expect(parseViewMode({})).toBe('inspect')
  })

  it('uses its own storage key', () => {
    expect(VIEW_MODE_STORAGE_KEY).toBe('tahi-qa-view-mode')
  })
})

describe('parseViewportKey', () => {
  it('accepts every real viewport key', () => {
    for (const v of QA_VIEWPORTS) expect(parseViewportKey(v.key)).toBe(v.key)
  })

  it('falls back to Desktop, or to the fallback given', () => {
    expect(DEFAULT_INSPECT_DEVICE).toBe('desktop')
    expect(parseViewportKey('huge')).toBe('desktop')
    expect(parseViewportKey(null)).toBe('desktop')
    expect(parseViewportKey(undefined, 'tablet')).toBe('tablet')
  })
})

describe('showsSingleFrame', () => {
  it('is always true in Inspect', () => {
    expect(showsSingleFrame(false, 'inspect')).toBe(true)
    expect(showsSingleFrame(true, 'inspect')).toBe(true)
  })

  it('follows the narrow layout in Overview', () => {
    expect(showsSingleFrame(false, 'overview')).toBe(false)
    expect(showsSingleFrame(true, 'overview')).toBe(true)
  })
})

describe('inspectDeviceOptions', () => {
  it('lists the five viewports in order, once each', () => {
    expect(inspectDeviceOptions(1000).map(o => o.value)).toEqual(QA_VIEWPORTS.map(v => v.key))
  })

  it('adds the pixel width when there is room', () => {
    const labels = inspectDeviceOptions(900).map(o => o.label)
    expect(labels).toEqual(['XL 1920', 'Desktop 1440', 'Tablet 768', 'Mobile L 425', 'Mobile P 375'])
  })

  it('drops the width at a middle width and uses short codes when narrow', () => {
    expect(inspectDeviceOptions(600).map(o => o.label)).toEqual(['XL', 'Desktop', 'Tablet', 'Mobile L', 'Mobile P'])
    expect(inspectDeviceOptions(375).map(o => o.label)).toEqual(['XL', 'Desk', 'Tab', 'ML', 'MP'])
  })

  it('treats an unmeasured width as the plain labels, never short codes', () => {
    expect(inspectDeviceOptions(0).map(o => o.label)).toEqual(['XL', 'Desktop', 'Tablet', 'Mobile L', 'Mobile P'])
  })

  it('always keeps the full name and width in the title', () => {
    for (const w of [0, 375, 600, 900]) {
      expect(inspectDeviceOptions(w).map(o => o.title)).toEqual(QA_VIEWPORTS.map(v => `${v.label} (${v.width}px)`))
    }
  })
})

describe('inspectOverflows and inspectScrollStep', () => {
  it('scrolls sideways only when the page is wider than the room', () => {
    expect(inspectOverflows(1920, 1000)).toBe(true)
    expect(inspectOverflows(375, 1000)).toBe(false)
    expect(inspectOverflows(1000, 1000)).toBe(false)
    expect(inspectOverflows(1920, 0)).toBe(false)
  })

  it('moves most of the visible width per step, at least one pixel', () => {
    expect(inspectScrollStep(1000)).toBe(800)
    expect(inspectScrollStep(0)).toBe(1)
  })
})

describe('viewAtFullSizeUrl', () => {
  const base = 'https://qa-view.example.workers.dev/v/tok.sig'

  it('joins the proxy base and the page path', () => {
    expect(viewAtFullSizeUrl(base, '/about')).toBe(`${base}/about`)
    expect(viewAtFullSizeUrl(base, '/')).toBe(`${base}/`)
    expect(viewAtFullSizeUrl(base, '/blog/post?x=1#top')).toBe(`${base}/blog/post?x=1#top`)
  })

  it('adds the missing leading slash and drops a trailing slash on the base', () => {
    expect(viewAtFullSizeUrl(base, 'about')).toBe(`${base}/about`)
    expect(viewAtFullSizeUrl(`${base}/`, '/about')).toBe(`${base}/about`)
  })

  it('never adds the reload parameter', () => {
    expect(viewAtFullSizeUrl(base, '/about')).not.toContain('_qa_reload')
  })

  it('refuses a base that is not an http(s) URL', () => {
    expect(viewAtFullSizeUrl('', '/about')).toBeNull()
    expect(viewAtFullSizeUrl('not a url', '/about')).toBeNull()
    expect(viewAtFullSizeUrl('javascript:alert(1)', '/about')).toBeNull()
    expect(viewAtFullSizeUrl('data:text/html,hi', '/about')).toBeNull()
  })
})

describe('isTokenFresh', () => {
  const now = 1_000_000

  it('is fresh while more than the margin is left', () => {
    expect(isTokenFresh(now + TOKEN_FRESH_MARGIN_MS + 1, now)).toBe(true)
    expect(isTokenFresh(now + TOKEN_FRESH_MARGIN_MS, now)).toBe(true)
  })

  it('is stale inside the margin, once expired, and when unknown', () => {
    expect(isTokenFresh(now + TOKEN_FRESH_MARGIN_MS - 1, now)).toBe(false)
    expect(isTokenFresh(now - 1, now)).toBe(false)
    expect(isTokenFresh(null, now)).toBe(false)
    expect(isTokenFresh(Number.NaN, now)).toBe(false)
  })

  it('takes a custom margin', () => {
    expect(isTokenFresh(now + 5000, now, 10_000)).toBe(false)
    expect(isTokenFresh(now + 15_000, now, 10_000)).toBe(true)
  })
})
