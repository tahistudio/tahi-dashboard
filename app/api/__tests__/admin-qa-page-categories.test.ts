/**
 * GET round-pages/[id]: the payload carries the same five categories the issue panel shows, the page
 * status and note, per-category counts and the stored PageSpeed scores, so an MCP caller that cannot
 * see the screen has the whole picture.
 */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ col, val }),
  and: (...list: unknown[]) => ({ list }),
  inArray: (col: string, val: unknown) => ({ col, val }),
  sql: () => ({}),
}))

const scanResult = {
  a11y: [{ id: 'color-contrast', impact: 'serious', help: 'Contrast too low', helpUrl: 'https://x', nodes: [{ selector: '.hero', html: '<p>' }, { selector: '.foot', html: '<p>' }] }],
  links: [],
  missingAnchors: [],
  seo: {
    title: null, metaDescription: null, canonical: null, robotsMeta: null,
    og: { title: null, description: null, image: null, url: null },
    h1Count: 0, headingOutline: [], headingSkips: [], jsonLd: { count: 0, parseErrors: 0 }, lang: null, favicon: null,
  },
  content: {
    imagesMissingAlt: [{ selector: 'img.logo', src: '/logo.png' }],
    stagingLeftovers: [{ kind: 'lorem_ipsum', sample: 'Lorem ipsum', selector: 'p.intro' }],
    forms: [],
  },
  layout: { horizontalOverflow: false, overflowingElements: [] },
  perf: { images: [], totalTransferSize: 0 },
}

const tables: Record<string, Row[]> = {
  scans: [{ roundPageId: 'rp_1', viewport: 'desktop', browser: 'chromium', result: JSON.stringify(scanResult), createdAt: '2026-10-30T00:00:00.000Z' }],
  ticks: [],
  links: [],
  roundPages: [{ id: 'rp_1', path: '/about' }],
}

vi.mock('@/db/d1', () => ({
  schema: {
    qaScanResults: { __t: 'scans', roundPageId: 'roundPageId', viewport: 'viewport' },
    qaBrowserTicks: { __t: 'ticks', roundPageId: 'roundPageId' },
    qaLinkResults: { __t: 'links', roundId: 'roundId', url: 'url' },
    qaRoundPages: { __t: 'roundPages', roundId: 'roundId' },
  },
}))
vi.mock('@/lib/db', () => ({
  db: vi.fn(async () => ({
    select: () => {
      let table = ''
      const chain: Record<string, unknown> = {}
      chain.from = (t: { __t: string }) => { table = t.__t; return chain }
      chain.where = () => chain
      chain.then = (resolve: (rows: Row[]) => unknown) => Promise.resolve(tables[table]).then(resolve)
      return chain
    },
  })),
}))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(async () => ({ userId: 'u', orgId: 'org_tahi', sessionId: 's' })),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn(async () => null) }))
vi.mock('@/lib/require-admin', () => ({ requireAdmin: vi.fn(async () => null) }))

const pagespeed = JSON.stringify({
  mobile: { score: 61, lcpMs: 3100, cls: 0.02, inpMs: null, tbtMs: 240, source: 'lab', fetchedAt: '2026-10-30T00:00:00.000Z' },
})

vi.mock('@/lib/qa/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qa/server')>()
  return {
    ...actual,
    loadRoundPage: vi.fn(async () => ({
      roundPage: { id: 'rp_1', path: '/about', status: 'fail', note: 'Hero needs a retake', pagespeed },
      round: { id: 'r_1', status: 'open', target: 'staging', browsers: '["chromium"]' },
      site: { id: 's_1', stagingUrl: 'https://acme.webflow.io', liveUrl: 'https://acme.com' },
    })),
  }
})

import { GET } from '@/app/api/admin/qa/round-pages/[id]/route'

describe('GET round-pages/[id] category payload', () => {
  it('returns status, note, pagespeed and per-category counts matching the issues', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/qa/round-pages/rp_1'), { params: Promise.resolve({ id: 'rp_1' }) })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      status: string
      note: string
      roundPage: { note: string }
      pagespeed: { mobile: { score: number }; desktop?: unknown }
      issues: { category: string; severity: string; message: string }[]
      categories: Record<string, { total: number }>
    }

    expect(json.status).toBe('fail')
    expect(json.note).toBe('Hero needs a retake')
    expect(json.roundPage.note).toBe('Hero needs a retake')
    expect(json.pagespeed.mobile.score).toBe(61)
    expect(json.pagespeed.desktop).toBeUndefined()

    const issues = json.issues
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) expect(['a11y', 'links', 'seo', 'launch', 'perf']).toContain(issue.category)

    for (const category of ['a11y', 'links', 'seo', 'launch', 'perf']) {
      expect(json.categories[category].total, category).toBe(issues.filter(i => i.category === category).length)
    }
    // The a11y violation, the missing alt and the leftover text come through with their detail.
    expect(issues.some(i => i.category === 'a11y' && i.message.includes('2 elements'))).toBe(true)
    expect(json.categories.launch.total).toBeGreaterThanOrEqual(2)
    expect(json.categories.seo.total).toBeGreaterThan(0)
  })
})
