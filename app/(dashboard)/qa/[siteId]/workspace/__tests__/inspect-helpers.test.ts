import { describe, expect, it } from 'vitest'
import { QA_VIEWPORTS, type QaViewportKey } from '@/lib/qa/types'
import type { QaScanState } from '../qa-types'
import {
  DEFAULT_VIEW_MODE,
  INSPECT_BORDER_PX,
  POPUP_SCROLLBAR_ALLOWANCE_PX,
  SIZED_WINDOW_BELOW_PX,
  TOKEN_FRESH_MARGIN_MS,
  VIEWPORT_SHORT_LABEL,
  VIEW_MODE_STORAGE_KEY,
  allViewportsScanned,
  defaultSingleFrameDevice,
  inspectDeviceOptions,
  inspectOverflows,
  inspectScrollStep,
  isTokenFresh,
  parseViewMode,
  showsSingleFrame,
  viewAtFullSizeFeatures,
  viewAtFullSizeHint,
  viewAtFullSizeKind,
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

describe('defaultSingleFrameDevice', () => {
  it('starts the narrow dashboard layout in Inspect on Mobile P', () => {
    expect(defaultSingleFrameDevice(true, 'inspect')).toBe('mobile_p')
  })

  it('starts everything else on Desktop', () => {
    expect(defaultSingleFrameDevice(false, 'inspect')).toBe('desktop')
    expect(defaultSingleFrameDevice(false, 'overview')).toBe('desktop')
    expect(defaultSingleFrameDevice(true, 'overview')).toBe('desktop')
  })
})

describe('allViewportsScanned and the short labels', () => {
  const states = (over: Partial<Record<QaViewportKey, QaScanState>> = {}): Record<QaViewportKey, QaScanState> => ({
    xl: 'scanned', desktop: 'scanned', tablet: 'scanned', mobile_l: 'scanned', mobile_p: 'scanned', ...over,
  })

  it('is true only when every viewport has a stored scan', () => {
    expect(allViewportsScanned(states())).toBe(true)
    expect(allViewportsScanned(states({ tablet: 'loading' }))).toBe(false)
    expect(allViewportsScanned(states({ mobile_p: 'no_scan' }))).toBe(false)
    expect(allViewportsScanned(states({ xl: 'failed' }))).toBe(false)
  })

  it('has one distinct short code for each viewport', () => {
    const codes = QA_VIEWPORTS.map(v => VIEWPORT_SHORT_LABEL[v.key])
    expect(new Set(codes).size).toBe(QA_VIEWPORTS.length)
    expect(VIEWPORT_SHORT_LABEL.mobile_l).toBe('ML')
    expect(VIEWPORT_SHORT_LABEL.mobile_p).toBe('MP')
  })
})

describe('viewAtFullSizeHint', () => {
  it('says a tab uses the window width, and starts with the visible label', () => {
    const h = viewAtFullSizeHint('Desktop', 1440)
    expect(h.title).toBe('View this page at 100% in a new tab (uses your window width)')
    expect(h.aria.startsWith('View at 100%')).toBe(true)
    expect(h.aria).toContain('new tab')
  })

  it('keeps the sized-window wording for the narrow frames', () => {
    const h = viewAtFullSizeHint('Mobile P', 375)
    expect(h.title).toBe('View Mobile P (375px) at 100% in a new window')
    expect(h.aria.startsWith('View at 100%')).toBe(true)
    expect(h.aria).toContain('new window 375 pixels wide')
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
    expect(inspectOverflows(1000, 1002)).toBe(false)
    expect(inspectOverflows(1920, 0)).toBe(false)
  })

  it('counts the 1px border on each side, so a 1 to 2px overflow still shows the hint', () => {
    expect(INSPECT_BORDER_PX).toBe(2)
    expect(inspectOverflows(1000, 1000)).toBe(true)
    expect(inspectOverflows(1000, 1001)).toBe(true)
    expect(inspectOverflows(1000, 1002)).toBe(false)
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

describe('viewAtFullSizeKind and viewAtFullSizeFeatures', () => {
  const byKey = (key: string) => {
    const v = QA_VIEWPORTS.find(x => x.key === key)
    if (!v) throw new Error(`no viewport ${key}`)
    return v
  }

  it('opens a sized window below 1024px and a normal tab at or above it', () => {
    expect(SIZED_WINDOW_BELOW_PX).toBe(1024)
    expect(viewAtFullSizeKind(375)).toBe('window')
    expect(viewAtFullSizeKind(768)).toBe('window')
    expect(viewAtFullSizeKind(1023)).toBe('window')
    expect(viewAtFullSizeKind(1024)).toBe('tab')
    expect(viewAtFullSizeKind(1440)).toBe('tab')
  })

  it('sizes the window to the device width plus the scrollbar allowance, and the device height', () => {
    expect(viewAtFullSizeFeatures(byKey('mobile_p'))).toBe(`popup,width=${375 + POPUP_SCROLLBAR_ALLOWANCE_PX},height=812,noopener,noreferrer`)
    expect(viewAtFullSizeFeatures(byKey('mobile_l'))).toBe(`popup,width=${425 + POPUP_SCROLLBAR_ALLOWANCE_PX},height=860,noopener,noreferrer`)
    expect(viewAtFullSizeFeatures(byKey('tablet'))).toBe(`popup,width=${768 + POPUP_SCROLLBAR_ALLOWANCE_PX},height=1024,noopener,noreferrer`)
  })

  it('gives the wide frames a plain tab with no size or popup flag', () => {
    expect(viewAtFullSizeFeatures(byKey('desktop'))).toBe('noopener,noreferrer')
    expect(viewAtFullSizeFeatures(byKey('xl'))).toBe('noopener,noreferrer')
  })

  it('always keeps noopener and noreferrer', () => {
    for (const v of QA_VIEWPORTS) {
      const features = viewAtFullSizeFeatures(v)
      expect(features).toContain('noopener')
      expect(features).toContain('noreferrer')
    }
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
