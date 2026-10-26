import { describe, it, expect } from 'vitest'
import type { QaScanResult, QaLinkResult } from '@/lib/qa/types'
import { seoIssues, launchIssues, perfIssues, a11yIssues, linkIssues, pageIssues, countIssues, duplicateMetaIssues } from '@/lib/qa/issue-rules'

function scan(over: Partial<QaScanResult> = {}): QaScanResult {
  return {
    a11y: [],
    links: [],
    missingAnchors: [],
    seo: {
      title: 'Acme, web design for builders', metaDescription: 'A'.repeat(80), canonical: 'https://acme.webflow.io/',
      robotsMeta: null, og: { title: 'Acme', description: 'd', image: 'https://x/og.png', url: null },
      h1Count: 1, headingOutline: [], headingSkips: [], jsonLd: { count: 1, parseErrors: 0 }, lang: 'en', favicon: '/favicon.ico',
    },
    content: { imagesMissingAlt: [], stagingLeftovers: [], forms: [] },
    layout: { horizontalOverflow: false, overflowingElements: [] },
    perf: { images: [], totalTransferSize: 0 },
    ...over,
  }
}

describe('seoIssues', () => {
  it('clean page has no issues on staging except the noindex warning', () => {
    const issues = seoIssues(scan().seo, 'staging', 'acme.webflow.io')
    expect(issues.map(i => i.code)).toEqual(['staging_indexable'])
    expect(issues[0].severity).toBe('warn')
  })
  it('flags missing and badly sized fields', () => {
    const s = scan({ seo: { ...scan().seo, title: null, metaDescription: 'short', canonical: null, h1Count: 2, lang: null } }).seo
    const codes = seoIssues(s, 'live', 'acme.com').map(i => i.code)
    expect(codes).toEqual(expect.arrayContaining(['title_missing', 'description_length', 'canonical_missing', 'h1_count', 'lang_missing']))
  })
  it('flags noindex on live and canonical on another host', () => {
    const s = { ...scan().seo, robotsMeta: 'noindex, nofollow', canonical: 'https://acme.webflow.io/' }
    const codes = seoIssues(s, 'live', 'acme.com').map(i => i.code)
    expect(codes).toContain('live_noindex')
    expect(codes).toContain('canonical_host')
  })
})

describe('launchIssues', () => {
  it('counts leftovers, missing alt, overflow per viewport and forms as info', () => {
    const desktop = scan({ content: { imagesMissingAlt: [{ selector: 'img', src: 'a.png' }], stagingLeftovers: [{ kind: 'lorem_ipsum', sample: 'Lorem ipsum', selector: 'p' }], forms: [{ action: null, method: 'get', fieldCount: 2, selector: 'form' }] } })
    const mobile = scan({ layout: { horizontalOverflow: true, overflowingElements: [{ selector: '.hero', width: 500 }] } })
    const issues = launchIssues({ desktop, mobile_p: mobile })
    expect(issues.map(i => i.code).sort()).toEqual(['form_present', 'image_alt_missing', 'horizontal_overflow', 'staging_leftover'].sort())
    expect(issues.find(i => i.code === 'horizontal_overflow')?.viewport).toBe('mobile_p')
    expect(issues.find(i => i.code === 'form_present')?.severity).toBe('info')
  })
})

describe('perfIssues', () => {
  it('flags heavy, oversized and legacy-format images, ignoring svg', () => {
    const img = { src: 'a.jpg', naturalWidth: 4000, naturalHeight: 2000, renderedWidth: 400, renderedHeight: 200, oversized: true, format: 'jpg', transferSize: 600_000 }
    const svg = { ...img, src: 'b.svg', format: 'svg', oversized: false, transferSize: 0 }
    const codes = perfIssues(scan({ perf: { images: [img, svg], totalTransferSize: 600_000 } }).perf, 'desktop').map(i => i.code).sort()
    expect(codes).toEqual(['image_format', 'image_heavy', 'image_oversized'])
  })
})

describe('a11yIssues and countIssues', () => {
  it('maps impacts into counts', () => {
    const s = scan({ a11y: [
      { id: 'color-contrast', impact: 'serious', help: 'h', helpUrl: 'u', nodes: [{ selector: 'a', html: '<a>' }] },
      { id: 'image-alt', impact: 'critical', help: 'h', helpUrl: 'u', nodes: [] },
      { id: 'region', impact: 'moderate', help: 'h', helpUrl: 'u', nodes: [] },
    ] })
    const counts = countIssues([...a11yIssues(s.a11y)])
    expect(counts).toMatchObject({ a11yCritical: 1, a11ySerious: 1, a11yModerate: 1, a11yMinor: 0 })
  })
})

describe('linkIssues', () => {
  it('reports broken links, chains, staging links and missing anchors that appear on the page', () => {
    const s = scan({ links: [{ url: 'https://x.com/a', text: 'A', selector: 'a.a' }, { url: 'https://x.com/b', text: 'B', selector: 'a.b' }], missingAnchors: [{ href: '#nope', selector: 'a.c' }] })
    const results = new Map<string, QaLinkResult>([
      ['https://x.com/a', { url: 'https://x.com/a', finalUrl: null, status: 404, hops: [], broken: true, redirectChain: false, stagingOnLive: false, error: null }],
      ['https://x.com/b', { url: 'https://x.com/b', finalUrl: 'https://x.com/c', status: 200, hops: [{ url: 'https://x.com/b', status: 301 }, { url: 'https://x.com/b2', status: 301 }], broken: false, redirectChain: true, stagingOnLive: false, error: null }],
    ])
    const codes = linkIssues(s, results).map(i => i.code).sort()
    expect(codes).toEqual(['anchor_missing', 'link_broken', 'redirect_chain'])
  })
})

describe('pageIssues', () => {
  it('combines everything and counts', () => {
    const issues = pageIssues({ desktop: scan() }, 'live', 'acme.webflow.io', new Map())
    expect(countIssues(issues).seoIssues).toBe(0)
  })
})

describe('duplicateMetaIssues', () => {
  it('finds titles shared by more than one page', () => {
    const dupes = duplicateMetaIssues([
      { path: '/a', title: 'Same', description: 'x' },
      { path: '/b', title: 'Same', description: 'y' },
      { path: '/c', title: 'Other', description: 'y' },
    ])
    expect(dupes.get('/a')?.map(i => i.code)).toEqual(['title_duplicate'])
    expect(dupes.get('/b')?.map(i => i.code).sort()).toEqual(['description_duplicate', 'title_duplicate'])
    expect(dupes.get('/c')?.map(i => i.code)).toEqual(['description_duplicate'])
  })
})
