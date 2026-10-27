import { describe, it, expect } from 'vitest'
import {
  countTicks,
  detectBrowser,
  issueDedupeKey,
  mergeBrowserIssues,
  mergeBrowserTicks,
  parseBrowserInput,
  parseRoundBrowsers,
} from '@/lib/qa/browsers'
import { browserPageIssues } from '@/lib/qa/issue-rules'
import { QA_BROWSERS, browserLabel, type QaIssue, type QaScanResult } from '@/lib/qa/types'

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 OPR/102.0.0.0',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  safariIpad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1',
  firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  edgeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.80 Mobile/15E148 Safari/605.1.15',
  playwrightWebkit: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
}

describe('detectBrowser', () => {
  it('reads Chromium family browsers as chromium', () => {
    for (const ua of [UA.chromeWin, UA.chromeMac, UA.chromeAndroid, UA.edge, UA.opera, UA.samsung]) {
      expect(detectBrowser(ua)).toBe('chromium')
    }
  })

  it('reads Firefox on desktop and Android as firefox', () => {
    for (const ua of [UA.firefoxWin, UA.firefoxMac, UA.firefoxAndroid]) expect(detectBrowser(ua)).toBe('firefox')
  })

  it('reads Safari, which names Safari but none of the Chromium or Firefox markers, as webkit', () => {
    expect(detectBrowser(UA.safariMac)).toBe('webkit')
    expect(detectBrowser(UA.playwrightWebkit)).toBe('webkit')
  })

  it('treats every iOS browser as webkit whatever its name says', () => {
    for (const ua of [UA.safariIphone, UA.safariIpad, UA.chromeIphone, UA.firefoxIphone, UA.edgeIphone]) {
      expect(detectBrowser(ua)).toBe('webkit')
    }
  })

  it('falls back to chromium for an empty or unknown agent', () => {
    expect(detectBrowser('')).toBe('chromium')
    expect(detectBrowser('curl/8.4.0')).toBe('chromium')
  })
})

describe('browser keys and labels', () => {
  it('exports Chrome, Firefox and Safari with short labels', () => {
    expect(QA_BROWSERS.map(b => [b.key, b.label, b.shortLabel])).toEqual([
      ['chromium', 'Chrome', 'Chr'],
      ['firefox', 'Firefox', 'Fx'],
      ['webkit', 'Safari', 'Saf'],
    ])
    expect(browserLabel('webkit')).toBe('Safari')
  })
})

describe('round browsers', () => {
  it('reads the stored column and defaults to Chrome', () => {
    expect(parseRoundBrowsers('["chromium","firefox"]')).toEqual(['chromium', 'firefox'])
    expect(parseRoundBrowsers(null)).toEqual(['chromium'])
    expect(parseRoundBrowsers(undefined)).toEqual(['chromium'])
    expect(parseRoundBrowsers('not json')).toEqual(['chromium'])
    expect(parseRoundBrowsers('[]')).toEqual(['chromium'])
    expect(parseRoundBrowsers('["netscape"]')).toEqual(['chromium'])
  })

  it('puts browsers in canonical order and drops repeats', () => {
    expect(parseRoundBrowsers('["webkit","chromium","webkit"]')).toEqual(['chromium', 'webkit'])
  })

  it('accepts a non-empty list of known browsers and nothing else', () => {
    expect(parseBrowserInput(['firefox', 'chromium'])).toEqual(['chromium', 'firefox'])
    expect(parseBrowserInput(['webkit'])).toEqual(['webkit'])
    expect(parseBrowserInput([])).toBeNull()
    expect(parseBrowserInput(['edge'])).toBeNull()
    expect(parseBrowserInput(['firefox', 3])).toBeNull()
    expect(parseBrowserInput('firefox')).toBeNull()
    expect(parseBrowserInput(undefined)).toBeNull()
  })
})

describe('mergeBrowserTicks', () => {
  const page = (id: string, over: Partial<{ vpXl: number; vpDesktop: number; vpTablet: number; vpMobileL: number; vpMobileP: number }> = {}) => ({
    id, vpXl: 0, vpDesktop: 0, vpTablet: 0, vpMobileL: 0, vpMobileP: 0, ...over,
  })

  it('reads Chrome from the vp columns and the others from the tick rows', () => {
    const merged = mergeBrowserTicks(
      [page('p1', { vpDesktop: 1, vpXl: 1 }), page('p2')],
      [
        { roundPageId: 'p1', browser: 'firefox', viewport: 'tablet', ticked: 1 },
        { roundPageId: 'p1', browser: 'firefox', viewport: 'desktop', ticked: 0 },
        { roundPageId: 'p2', browser: 'webkit', viewport: 'mobile_p', ticked: 1 },
      ],
      ['chromium', 'firefox', 'webkit'],
    )
    expect(merged.get('p1')?.chromium).toEqual({ xl: true, desktop: true, tablet: false, mobile_l: false, mobile_p: false })
    expect(merged.get('p1')?.firefox).toEqual({ xl: false, desktop: false, tablet: true, mobile_l: false, mobile_p: false })
    expect(merged.get('p1')?.webkit).toEqual({ xl: false, desktop: false, tablet: false, mobile_l: false, mobile_p: false })
    expect(merged.get('p2')?.webkit?.mobile_p).toBe(true)
  })

  it('returns only the round browsers, so a removed browser is hidden but its rows stay in the table', () => {
    const merged = mergeBrowserTicks(
      [page('p1', { vpDesktop: 1 })],
      [{ roundPageId: 'p1', browser: 'firefox', viewport: 'xl', ticked: 1 }],
      ['chromium'],
    )
    expect(Object.keys(merged.get('p1') ?? {})).toEqual(['chromium'])
  })

  it('ignores a chromium tick row, an unknown browser, an unknown viewport and a row for another page', () => {
    const merged = mergeBrowserTicks(
      [page('p1')],
      [
        { roundPageId: 'p1', browser: 'chromium', viewport: 'xl', ticked: 1 },
        { roundPageId: 'p1', browser: 'edge', viewport: 'xl', ticked: 1 },
        { roundPageId: 'p1', browser: 'firefox', viewport: 'huge', ticked: 1 },
        { roundPageId: 'zzz', browser: 'firefox', viewport: 'xl', ticked: 1 },
      ],
      ['chromium', 'firefox'],
    )
    expect(merged.get('p1')?.chromium?.xl).toBe(false)
    expect(Object.values(merged.get('p1')?.firefox ?? {}).some(Boolean)).toBe(false)
  })

  it('countTicks sums the ticks of the chosen browsers', () => {
    const merged = mergeBrowserTicks(
      [page('p1', { vpDesktop: 1, vpXl: 1 })],
      [{ roundPageId: 'p1', browser: 'firefox', viewport: 'tablet', ticked: 1 }],
      ['chromium', 'firefox'],
    )
    const ticks = merged.get('p1') ?? {}
    expect(countTicks(ticks, ['chromium'])).toBe(2)
    expect(countTicks(ticks, ['chromium', 'firefox'])).toBe(3)
    expect(countTicks(ticks, ['webkit'])).toBe(0)
  })
})

describe('mergeBrowserIssues', () => {
  const issue = (over: Partial<QaIssue> = {}): QaIssue => ({
    category: 'a11y', code: 'axe_serious', severity: 'fail', message: 'Buttons need a name', selector: '#cta', viewport: 'desktop', ...over,
  })

  it('shows an identical issue once, with every browser that showed it', () => {
    const merged = mergeBrowserIssues([
      ['chromium', [issue()]],
      ['firefox', [issue()]],
      ['webkit', [issue()]],
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].browser).toBe('chromium')
    expect(merged[0].browsers).toEqual(['chromium', 'firefox', 'webkit'])
  })

  it('keeps an issue only one browser showed, tagged with that browser', () => {
    const merged = mergeBrowserIssues([
      ['chromium', [issue()]],
      ['firefox', [issue(), issue({ code: 'horizontal_overflow', category: 'launch', selector: '.row' })]],
    ])
    expect(merged).toHaveLength(2)
    expect(merged.find(i => i.code === 'horizontal_overflow')?.browsers).toEqual(['firefox'])
    expect(merged.find(i => i.code === 'axe_serious')?.browsers).toEqual(['chromium', 'firefox'])
  })

  it('does not merge issues on different viewports or selectors', () => {
    const merged = mergeBrowserIssues([
      ['chromium', [issue({ viewport: 'desktop' })]],
      ['firefox', [issue({ viewport: 'tablet' }), issue({ selector: '#other' })]],
    ])
    expect(merged).toHaveLength(3)
  })

  it('keeps repeats inside one browser and merges the nth repeat with the nth repeat elsewhere', () => {
    const merged = mergeBrowserIssues([
      ['chromium', [issue(), issue()]],
      ['firefox', [issue(), issue(), issue()]],
    ])
    expect(merged).toHaveLength(3)
    expect(merged.filter(i => i.browsers?.length === 2)).toHaveLength(2)
    expect(merged.filter(i => i.browsers?.join() === 'firefox')).toHaveLength(1)
  })

  it('keeps two axe rules of the same impact on one element apart (different help urls)', () => {
    const merged = mergeBrowserIssues([
      ['chromium', [issue({ url: 'https://dequeuniversity.com/rules/axe/4/button-name' })]],
      ['firefox', [issue({ url: 'https://dequeuniversity.com/rules/axe/4/aria-allowed-attr' })]],
    ])
    expect(merged).toHaveLength(2)
  })

  it('merges a perf issue across browsers even when the flagged viewport differs', () => {
    const perf = (viewport: 'desktop' | 'mobile_p') => issue({ category: 'perf', code: 'image_heavy', selector: undefined, url: 'https://x/a.png', viewport })
    const merged = mergeBrowserIssues([
      ['chromium', [perf('desktop')]],
      ['firefox', [perf('mobile_p')]],
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].browsers).toEqual(['chromium', 'firefox'])
  })

  it('merges a broken link across browsers even when the first element differs', () => {
    const link = (selector: string) => issue({ category: 'links', code: 'link_broken', selector, url: 'https://x/gone' })
    const merged = mergeBrowserIssues([
      ['chromium', [link('#a')]],
      ['firefox', [link('#b')]],
    ])
    expect(merged).toHaveLength(1)
  })

  it('keeps anchor issues without a url apart by selector', () => {
    const anchor = (selector: string) => issue({ category: 'links', code: 'anchor_missing', selector, url: undefined })
    expect(issueDedupeKey(anchor('#a'))).not.toBe(issueDedupeKey(anchor('#b')))
  })

  it('tells selectorless issues apart by url, then message', () => {
    expect(issueDedupeKey(issue({ selector: undefined, url: 'https://x/a.png', message: 'm1' })))
      .toBe(issueDedupeKey(issue({ selector: undefined, url: 'https://x/a.png', message: 'm2' })))
    expect(issueDedupeKey(issue({ selector: undefined, url: undefined, message: 'm1' })))
      .not.toBe(issueDedupeKey(issue({ selector: undefined, url: undefined, message: 'm2' })))
  })

  it('is the plain list, tagged, for a single browser', () => {
    const merged = mergeBrowserIssues([['chromium', [issue(), issue({ selector: '#b' })]]])
    expect(merged).toHaveLength(2)
    expect(merged.every(i => i.browsers?.join() === 'chromium')).toBe(true)
  })
})

function scan(over: Partial<QaScanResult> = {}): QaScanResult {
  return {
    a11y: [],
    links: [],
    missingAnchors: [],
    seo: {
      title: 'A reasonable page title', metaDescription: 'A meta description that is long enough to pass the length check comfortably.',
      canonical: 'https://site.test/', robotsMeta: 'noindex', og: { title: 't', description: 'd', image: 'i', url: 'u' },
      h1Count: 1, headingOutline: [], headingSkips: [], jsonLd: { count: 0, parseErrors: 0 }, lang: 'en', favicon: null,
    },
    content: { imagesMissingAlt: [], stagingLeftovers: [], forms: [] },
    layout: { horizontalOverflow: false, overflowingElements: [] },
    perf: { images: [], totalTransferSize: 0 },
    ...over,
  }
}

describe('browserPageIssues', () => {
  const overflow = scan({ layout: { horizontalOverflow: true, overflowingElements: [{ selector: '.wide', width: 2000 }] } })

  it('does not triple the issues when three browsers show the same finding', () => {
    const issues = browserPageIssues(
      { chromium: { desktop: overflow }, firefox: { desktop: overflow }, webkit: { desktop: overflow } },
      'staging', 'site.test', new Map(),
    )
    const overflows = issues.filter(i => i.code === 'horizontal_overflow')
    expect(overflows).toHaveLength(1)
    expect(overflows[0].browsers).toEqual(['chromium', 'firefox', 'webkit'])
  })

  it('reports a finding only one browser has, and counts as one browser when only one was scanned', () => {
    const issues = browserPageIssues(
      { chromium: { desktop: scan() }, webkit: { desktop: overflow } },
      'staging', 'site.test', new Map(),
    )
    const found = issues.find(i => i.code === 'horizontal_overflow')
    expect(found?.browsers).toEqual(['webkit'])
    expect(browserPageIssues({}, 'staging', 'site.test', new Map())).toEqual([])
  })
})

describe('scansByBrowser with a browser filter', () => {
  it('leaves out scans of browsers that are not in the round', async () => {
    const { scansByBrowser } = await import('@/lib/qa/server')
    const row = (browser: string) => ({ viewport: 'desktop', browser, result: JSON.stringify({}) })
    const all = scansByBrowser([row('chromium'), row('firefox')])
    expect(Object.keys(all)).toEqual(['chromium', 'firefox'])
    expect(Object.keys(scansByBrowser([row('chromium'), row('firefox')], ['chromium']))).toEqual(['chromium'])
    expect(scansByBrowser([row('firefox')], ['chromium'])).toEqual({})
  })
})
