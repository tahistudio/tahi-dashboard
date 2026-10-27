/**
 * Site QA rounds, round pages and scan routes: admin gate on every handler,
 * round snapshot sampling, closed-round guards and scan body limits.
 * D1 is replaced by an in-memory fake keyed by real table names. Filters are
 * not applied, so each test seeds only the rows its handler should read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { getTableName } from 'drizzle-orm'

type Row = Record<string, unknown>
interface Write { op: 'insert' | 'update'; table: string; rows: Row[]; set?: Row }

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as Write[],
  reads: [] as string[],
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: async () => null }))
vi.mock('@/lib/require-admin', () => ({ requireAdmin: async () => null }))

vi.mock('@/db/d1', async () => ({
  schema: await vi.importActual<typeof import('@/db/schema')>('@/db/schema'),
}))

vi.mock('@/lib/db', () => {
  function thenable<T>(value: () => T, onRun?: () => void) {
    const builder = {
      then(resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) {
        onRun?.()
        return Promise.resolve(value()).then(resolve, reject)
      },
      onConflictDoUpdate: () => builder,
      innerJoin: () => builder,
      groupBy: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
    }
    return builder
  }
  const fake = {
    select: () => ({
      from: (table: unknown) => {
        const name = getTableName(table as Parameters<typeof getTableName>[0])
        state.reads.push(name)
        return thenable(() => [...(state.tables[name] ?? [])])
      },
    }),
    insert: (table: unknown) => {
      const name = getTableName(table as Parameters<typeof getTableName>[0])
      return {
        values: (v: Row | Row[]) => {
          const rows = Array.isArray(v) ? v : [v]
          return thenable(() => undefined, () => state.writes.push({ op: 'insert', table: name, rows }))
        },
      }
    },
    update: (table: unknown) => {
      const name = getTableName(table as Parameters<typeof getTableName>[0])
      return {
        set: (s: Row) => thenable(() => undefined, () => state.writes.push({ op: 'update', table: name, rows: [], set: s })),
      }
    },
    batch: async (items: PromiseLike<unknown>[]) => {
      const out: unknown[] = []
      for (const item of items) out.push(await item)
      return out
    },
  }
  return { db: vi.fn(async () => fake) }
})

import { GET as roundsGet, POST as roundsPost } from '@/app/api/admin/qa/sites/[id]/rounds/route'
import { GET as roundGet, PATCH as roundPatch } from '@/app/api/admin/qa/rounds/[id]/route'
import { POST as samplesPost } from '@/app/api/admin/qa/rounds/[id]/samples/route'
import { GET as roundPageGet, PATCH as roundPagePatch } from '@/app/api/admin/qa/round-pages/[id]/route'
import { POST as scanPost } from '@/app/api/admin/qa/round-pages/[id]/scan/route'
import { getRequestAuth } from '@/lib/server-auth'
import { normaliseScanResult } from '@/lib/qa/normalise-scan'

const ADMIN = { userId: 'user_liam', orgId: 'org_tahi', sessionId: 's1' }
const CLIENT = { userId: 'user_client', orgId: 'org_client', sessionId: 's2' }
const NOW = '2026-10-26T10:00:00.000Z'

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function jsonReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/qa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/qa')
}

function seedSite(overrides: Row = {}): Row {
  return {
    id: 'site1', orgId: 'org_acme', name: 'Acme', stagingUrl: 'https://acme-staging.webflow.io',
    liveUrl: null, notes: null, createdBy: 'user_liam', createdAt: NOW, updatedAt: NOW, archivedAt: null,
    ...overrides,
  }
}

function seedRound(overrides: Row = {}): Row {
  return {
    id: 'round1', siteId: 'site1', name: 'Launch', target: 'staging', status: 'open',
    browsers: '["chromium"]', siteChecks: null, siteChecksAt: null, redirectMap: null, redirectMapAt: null,
    createdBy: 'user_liam', createdAt: NOW, closedAt: null, ...overrides,
  }
}

function seedRoundPage(overrides: Row = {}): Row {
  return {
    id: 'rp1', roundId: 'round1', pageId: 'page1', path: '/', groupKey: null, sortOrder: 0,
    vpXl: 0, vpDesktop: 0, vpTablet: 0, vpMobileL: 0, vpMobileP: 0, status: 'untested', note: null,
    requestIds: null, a11yCritical: null, a11ySerious: null, a11yModerate: null, a11yMinor: null,
    brokenLinks: null, seoIssues: null, launchIssues: null, perfIssues: null, scannedAt: null,
    pagespeed: null, pagespeedAt: null, updatedBy: null, updatedAt: NOW, ...overrides,
  }
}

function seedPage(id: string, path: string, groupKey: string | null): Row {
  return {
    id, siteId: 'site1', path, title: null, groupKey, source: 'sitemap', removedAt: null, createdAt: NOW, updatedAt: NOW,
  }
}

function seed(name: string, rows: Row[]) {
  state.tables[name] = rows
}

function writesFor(table: string, op: Write['op'] = 'insert'): Write[] {
  return state.writes.filter(w => w.table === table && w.op === op)
}

function cleanScan(overrides: Row = {}): Row {
  return {
    a11y: [], links: [], missingAnchors: [],
    seo: { title: 'Home', metaDescription: 'Home page' },
    content: {}, layout: {}, perf: { images: [], totalTransferSize: 0 },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.tables = {}
  state.writes = []
  state.reads = []
  vi.mocked(getRequestAuth).mockResolvedValue(ADMIN)
})

describe('admin gate on every handler', () => {
  beforeEach(() => {
    vi.mocked(getRequestAuth).mockResolvedValue(CLIENT)
  })

  it('403s a non-Tahi caller on every handler', async () => {
    const results = await Promise.all([
      roundsGet(getReq(), ctx('site1')),
      roundsPost(jsonReq({ name: 'x', target: 'staging' }), ctx('site1')),
      roundGet(getReq(), ctx('round1')),
      roundPatch(jsonReq({ name: 'x' }), ctx('round1')),
      samplesPost(jsonReq({ groupKey: '/blog/*' }), ctx('round1')),
      roundPageGet(getReq(), ctx('rp1')),
      roundPagePatch(jsonReq({ status: 'pass' }), ctx('rp1')),
      scanPost(jsonReq({ viewport: 'desktop', result: cleanScan() }), ctx('rp1')),
    ])
    for (const res of results) expect(res.status).toBe(403)
    expect(state.writes).toHaveLength(0)
  })
})

describe('POST /api/admin/qa/sites/[id]/rounds', () => {
  it('snapshots ungrouped pages plus three samples of an 8-page blog group', async () => {
    seed('qa_sites', [seedSite()])
    const blog = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(s => seedPage(`blog-${s}`, `/blog/${s}`, '/blog/*'))
    seed('qa_pages', [seedPage('home', '/', null), seedPage('about', '/about', null), ...blog])

    const res = await roundsPost(jsonReq({ name: '  Launch  ', target: 'staging' }), ctx('site1'))
    expect(res.status).toBe(201)

    const roundWrites = writesFor('qa_rounds')
    expect(roundWrites).toHaveLength(1)
    expect(roundWrites[0].rows[0]).toMatchObject({ siteId: 'site1', name: 'Launch', target: 'staging', status: 'open' })

    const pageRows = writesFor('qa_round_pages').flatMap(w => w.rows)
    expect(pageRows).toHaveLength(2 + 3)
    const paths = pageRows.map(r => r.path)
    expect(paths.slice(0, 2)).toEqual(['/', '/about'])
    expect(paths.slice(2)).toEqual(['/blog/a', '/blog/b', '/blog/c'])
    expect(pageRows.every(r => r.roundId === roundWrites[0].rows[0].id)).toBe(true)
  })

  it('keeps every insert within the D1 parameter cap of 100 bound values', async () => {
    seed('qa_sites', [seedSite()])
    seed('qa_pages', Array.from({ length: 30 }, (_, i) => seedPage(`p${i}`, `/page-${i}`, null)))

    const res = await roundsPost(jsonReq({ name: 'Bulk', target: 'staging' }), ctx('site1'))
    expect(res.status).toBe(201)
    const pageWrites = writesFor('qa_round_pages')
    expect(pageWrites.length).toBeGreaterThan(1)
    for (const w of pageWrites) expect(w.rows.length * 13).toBeLessThanOrEqual(100)
  })

  it('400s when the site has no pages to snapshot', async () => {
    seed('qa_sites', [seedSite()])
    seed('qa_pages', [])
    const res = await roundsPost(jsonReq({ name: 'Empty', target: 'staging' }), ctx('site1'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Import or add pages before starting a round' })
    expect(state.writes).toHaveLength(0)
  })

  it('404s GET and POST for an archived site', async () => {
    seed('qa_sites', [seedSite({ archivedAt: NOW })])
    seed('qa_pages', [seedPage('home', '/', null)])
    expect((await roundsGet(getReq(), ctx('site1'))).status).toBe(404)
    expect((await roundsPost(jsonReq({ name: 'x', target: 'staging' }), ctx('site1'))).status).toBe(404)
    expect(state.writes).toHaveLength(0)
  })

  it('400s when there is no name, a bad target, or no URL for the target', async () => {
    seed('qa_sites', [seedSite({ liveUrl: null })])
    expect((await roundsPost(jsonReq({ target: 'staging' }), ctx('site1'))).status).toBe(400)
    expect((await roundsPost(jsonReq({ name: 'x', target: 'preview' }), ctx('site1'))).status).toBe(400)
    expect((await roundsPost(jsonReq({ name: 'x', target: 'live' }), ctx('site1'))).status).toBe(400)
    expect(writesFor('qa_rounds')).toHaveLength(0)
  })
})

describe('round and samples routes', () => {
  it('samples 409s on a closed round', async () => {
    seed('qa_rounds', [seedRound({ status: 'closed' })])
    seed('qa_sites', [seedSite()])
    const res = await samplesPost(jsonReq({ groupKey: '/blog/*' }), ctx('round1'))
    expect(res.status).toBe(409)
    expect(state.writes).toHaveLength(0)
  })

  it('samples 400s a count outside 1 to 20', async () => {
    seed('qa_rounds', [seedRound()])
    seed('qa_sites', [seedSite()])
    expect((await samplesPost(jsonReq({ groupKey: '/blog/*', count: 0 }), ctx('round1'))).status).toBe(400)
    expect((await samplesPost(jsonReq({ groupKey: '/blog/*', count: 21 }), ctx('round1'))).status).toBe(400)
  })

  it('PATCH round with status closed stamps closedAt', async () => {
    seed('qa_rounds', [seedRound()])
    seed('qa_sites', [seedSite()])
    const res = await roundPatch(jsonReq({ status: 'closed' }), ctx('round1'))
    expect(res.status).toBe(200)
    const [write] = writesFor('qa_rounds', 'update')
    expect(write.set).toMatchObject({ status: 'closed' })
    expect(typeof write.set?.closedAt).toBe('string')
  })

  it('PATCH round with status open clears closedAt', async () => {
    seed('qa_rounds', [seedRound({ status: 'closed', closedAt: NOW })])
    seed('qa_sites', [seedSite()])
    await roundPatch(jsonReq({ status: 'open' }), ctx('round1'))
    const [write] = writesFor('qa_rounds', 'update')
    expect(write.set).toMatchObject({ status: 'open', closedAt: null })
  })
})

describe('PATCH /api/admin/qa/round-pages/[id]', () => {
  it('409s when the round is closed', async () => {
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_rounds', [seedRound({ status: 'closed' })])
    seed('qa_sites', [seedSite()])
    const res = await roundPagePatch(jsonReq({ status: 'pass' }), ctx('rp1'))
    expect(res.status).toBe(409)
    expect(writesFor('qa_round_pages', 'update')).toHaveLength(0)
  })

  it('maps vp booleans to columns and stamps updatedBy on an open round', async () => {
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_rounds', [seedRound()])
    seed('qa_sites', [seedSite()])
    const res = await roundPagePatch(jsonReq({ vp: { desktop: true, mobile_p: false }, status: 'fail', note: 'Hero overlaps' }), ctx('rp1'))
    expect(res.status).toBe(200)
    const [write] = writesFor('qa_round_pages', 'update')
    expect(write.set).toMatchObject({ vpDesktop: 1, vpMobileP: 0, status: 'fail', note: 'Hero overlaps', updatedBy: 'user_liam' })
  })

  it('400s an unknown status and an over-long note', async () => {
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_rounds', [seedRound()])
    seed('qa_sites', [seedSite()])
    expect((await roundPagePatch(jsonReq({ status: 'maybe' }), ctx('rp1'))).status).toBe(400)
    expect((await roundPagePatch(jsonReq({ note: 'x'.repeat(4001) }), ctx('rp1'))).status).toBe(400)
  })
})

describe('POST /api/admin/qa/round-pages/[id]/scan', () => {
  beforeEach(() => {
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_rounds', [seedRound()])
    seed('qa_sites', [seedSite()])
  })

  it('400s an unknown viewport', async () => {
    const res = await scanPost(jsonReq({ viewport: 'watch', result: cleanScan() }), ctx('rp1'))
    expect(res.status).toBe(400)
    expect(writesFor('qa_scan_results')).toHaveLength(0)
  })

  it('413s a result over 512 KB', async () => {
    const big = cleanScan({ seo: { title: 'x'.repeat(520_000) } })
    const res = await scanPost(jsonReq({ viewport: 'desktop', result: big }), ctx('rp1'))
    expect(res.status).toBe(413)
    expect(writesFor('qa_scan_results')).toHaveLength(0)
  })

  it('stores a valid scan for the viewport and stamps scannedAt', async () => {
    const res = await scanPost(jsonReq({ viewport: 'desktop', result: cleanScan() }), ctx('rp1'))
    expect(res.status).toBe(200)
    const [scan] = writesFor('qa_scan_results')
    expect(scan.rows[0]).toMatchObject({ roundPageId: 'rp1', viewport: 'desktop' })
    const [stamp] = writesFor('qa_round_pages', 'update')
    expect(stamp.set).toMatchObject({ scannedAt: expect.any(String) })
  })
})

describe('hostile scan payload', () => {
  it('normalises, stores and counts it, and the round page GET still works', async () => {
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_rounds', [seedRound()])
    seed('qa_sites', [seedSite()])
    const hostile = { seo: {}, perf: {}, a11y: 'x', links: [{ url: 5 }], content: 'x', layout: null, missingAnchors: 7 }
    // The fake ignores filters, so seed what the insert would have stored for the recount to read.
    seed('qa_scan_results', [{ roundPageId: 'rp1', viewport: 'desktop', result: JSON.stringify(normaliseScanResult(hostile)), createdAt: NOW }])
    const res = await scanPost(jsonReq({ viewport: 'desktop', result: hostile }), ctx('rp1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
    const [scan] = writesFor('qa_scan_results')
    const stored = JSON.parse(scan.rows[0].result as string) as Record<string, unknown>
    expect(stored.a11y).toEqual([])
    expect(stored.links).toEqual([{ url: '', text: '', selector: '' }])
    expect(stored.perf).toEqual({ images: [], totalTransferSize: 0 })
    expect(writesFor('qa_round_pages', 'update').some(w => w.set && 'a11yCritical' in w.set)).toBe(true)
    seed('qa_scan_results', [{ roundPageId: 'rp1', viewport: 'desktop', result: JSON.stringify({ seo: {}, perf: {}, a11y: 'x', links: [{ url: 5 }] }), createdAt: NOW }])
    const get = await roundPageGet(getReq(), ctx('rp1'))
    expect(get.status).toBe(200)
  })
})

describe('POST scan on a closed round', () => {
  it('409s and stores nothing', async () => {
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_rounds', [seedRound({ status: 'closed' })])
    seed('qa_sites', [seedSite()])
    const res = await scanPost(jsonReq({ viewport: 'desktop', result: cleanScan() }), ctx('rp1'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This round is closed' })
    expect(writesFor('qa_scan_results')).toHaveLength(0)
    expect(writesFor('qa_round_pages', 'update')).toHaveLength(0)
  })
})

describe('browsers per round', () => {
  const both = JSON.stringify(['chromium', 'firefox'])

  describe('POST /api/admin/qa/sites/[id]/rounds', () => {
    beforeEach(() => {
      seed('qa_sites', [seedSite()])
      seed('qa_pages', [seedPage('home', '/', null)])
    })

    it('defaults to Chrome only', async () => {
      const res = await roundsPost(jsonReq({ name: 'R', target: 'staging' }), ctx('site1'))
      expect(res.status).toBe(201)
      expect(writesFor('qa_rounds')[0].rows[0].browsers).toBe('["chromium"]')
      expect(((await res.json()) as { item: { browsers: string[] } }).item.browsers).toEqual(['chromium'])
    })

    it('stores the chosen browsers in canonical order', async () => {
      const res = await roundsPost(jsonReq({ name: 'R', target: 'staging', browsers: ['webkit', 'chromium', 'webkit'] }), ctx('site1'))
      expect(res.status).toBe(201)
      expect(writesFor('qa_rounds')[0].rows[0].browsers).toBe('["chromium","webkit"]')
    })

    it('400s an empty, unknown or non-list browsers value and writes nothing', async () => {
      for (const browsers of [[], ['edge'], 'firefox', [3]]) {
        const res = await roundsPost(jsonReq({ name: 'R', target: 'staging', browsers }), ctx('site1'))
        expect(res.status).toBe(400)
      }
      expect(state.writes).toHaveLength(0)
    })
  })

  describe('PATCH /api/admin/qa/rounds/[id]', () => {
    beforeEach(() => {
      seed('qa_sites', [seedSite()])
    })

    it('changes the browsers of an open round', async () => {
      seed('qa_rounds', [seedRound()])
      const res = await roundPatch(jsonReq({ browsers: ['firefox', 'chromium'] }), ctx('round1'))
      expect(res.status).toBe(200)
      expect(writesFor('qa_rounds', 'update')[0].set).toEqual({ browsers: both })
      expect(((await res.json()) as { item: { browsers: string[] } }).item.browsers).toEqual(['chromium', 'firefox'])
    })

    it('409s on a closed round and writes nothing', async () => {
      seed('qa_rounds', [seedRound({ status: 'closed' })])
      const res = await roundPatch(jsonReq({ browsers: ['chromium', 'firefox'] }), ctx('round1'))
      expect(res.status).toBe(409)
      expect(writesFor('qa_rounds', 'update')).toHaveLength(0)
    })

    it('400s an empty or unknown list', async () => {
      seed('qa_rounds', [seedRound()])
      expect((await roundPatch(jsonReq({ browsers: [] }), ctx('round1'))).status).toBe(400)
      expect((await roundPatch(jsonReq({ browsers: ['edge'] }), ctx('round1'))).status).toBe(400)
      expect(writesFor('qa_rounds', 'update')).toHaveLength(0)
    })

    it('still renames or closes a closed round (reopen) without browsers', async () => {
      seed('qa_rounds', [seedRound({ status: 'closed', closedAt: NOW })])
      const res = await roundPatch(jsonReq({ status: 'open' }), ctx('round1'))
      expect(res.status).toBe(200)
    })
  })

  describe('GET /api/admin/qa/rounds/[id]', () => {
    it('returns the browsers and, per page, ticks per browser from one tick query', async () => {
      seed('qa_sites', [seedSite()])
      seed('qa_rounds', [seedRound({ browsers: both })])
      const pages = Array.from({ length: 25 }, (_, i) => seedRoundPage({ id: `rp${i}`, path: `/p${i}`, sortOrder: i, vpDesktop: i === 0 ? 1 : 0 }))
      seed('qa_round_pages', pages)
      seed('qa_pages', [])
      seed('qa_browser_ticks', [
        { roundPageId: 'rp0', browser: 'firefox', viewport: 'tablet', ticked: 1 },
        { roundPageId: 'rp1', browser: 'firefox', viewport: 'xl', ticked: 1 },
        { roundPageId: 'rp1', browser: 'firefox', viewport: 'desktop', ticked: 0 },
      ])
      const res = await roundGet(getReq(), ctx('round1'))
      expect(res.status).toBe(200)
      const json = (await res.json()) as {
        round: { browsers: string[] }
        pages: { id: string; browserTicks: Record<string, Record<string, boolean>> }[]
      }
      expect(json.round.browsers).toEqual(['chromium', 'firefox'])
      const first = json.pages.find(p => p.id === 'rp0')
      expect(first?.browserTicks.chromium.desktop).toBe(true)
      expect(first?.browserTicks.firefox.tablet).toBe(true)
      expect(first?.browserTicks.firefox.desktop).toBe(false)
      expect(json.pages.find(p => p.id === 'rp1')?.browserTicks.firefox.xl).toBe(true)
      expect(json.pages.find(p => p.id === 'rp24')?.browserTicks.firefox.xl).toBe(false)
      // One query over qa_browser_ticks for the whole round, not one per page.
      expect(state.reads.filter(t => t === 'qa_browser_ticks')).toHaveLength(1)
    })

    it('skips the tick query for a Chrome only round and reports Chrome ticks', async () => {
      seed('qa_sites', [seedSite()])
      seed('qa_rounds', [seedRound()])
      seed('qa_round_pages', [seedRoundPage({ vpXl: 1 })])
      seed('qa_pages', [])
      const json = (await (await roundGet(getReq(), ctx('round1'))).json()) as {
        round: { browsers: string[] }
        pages: { browserTicks: Record<string, Record<string, boolean>> }[]
      }
      expect(json.round.browsers).toEqual(['chromium'])
      expect(json.pages[0].browserTicks).toEqual({ chromium: { xl: true, desktop: false, tablet: false, mobile_l: false, mobile_p: false } })
      expect(state.reads).not.toContain('qa_browser_ticks')
    })
  })

  describe('PATCH /api/admin/qa/round-pages/[id] with a browser', () => {
    beforeEach(() => {
      seed('qa_round_pages', [seedRoundPage()])
      seed('qa_sites', [seedSite()])
    })

    it('writes Chrome ticks to the vp columns, as before', async () => {
      seed('qa_rounds', [seedRound({ browsers: both })])
      const res = await roundPagePatch(jsonReq({ browser: 'chromium', vp: { desktop: true } }), ctx('rp1'))
      expect(res.status).toBe(200)
      expect(writesFor('qa_round_pages', 'update')[0].set).toMatchObject({ vpDesktop: 1 })
      expect(writesFor('qa_browser_ticks')).toHaveLength(0)
    })

    it('upserts Firefox ticks into qa_browser_ticks and leaves the vp columns alone', async () => {
      seed('qa_rounds', [seedRound({ browsers: both })])
      const res = await roundPagePatch(jsonReq({ browser: 'firefox', vp: { desktop: true, tablet: false } }), ctx('rp1'))
      expect(res.status).toBe(200)
      const [write] = writesFor('qa_browser_ticks')
      expect(write.rows).toEqual([
        expect.objectContaining({ roundPageId: 'rp1', browser: 'firefox', viewport: 'desktop', ticked: 1, updatedBy: 'user_liam' }),
        expect.objectContaining({ roundPageId: 'rp1', browser: 'firefox', viewport: 'tablet', ticked: 0 }),
      ])
      const pageUpdate = writesFor('qa_round_pages', 'update')[0].set ?? {}
      expect('vpDesktop' in pageUpdate).toBe(false)
      expect('vpTablet' in pageUpdate).toBe(false)
    })

    it('keeps each tick write under the D1 parameter cap', async () => {
      seed('qa_rounds', [seedRound({ browsers: both })])
      await roundPagePatch(jsonReq({ browser: 'firefox', vp: { xl: true, desktop: true, tablet: true, mobile_l: true, mobile_p: true } }), ctx('rp1'))
      const [write] = writesFor('qa_browser_ticks')
      expect(write.rows.length * 7).toBeLessThanOrEqual(100)
    })

    it('400s a browser that is not part of the round and writes nothing', async () => {
      seed('qa_rounds', [seedRound()])
      const res = await roundPagePatch(jsonReq({ browser: 'firefox', vp: { desktop: true } }), ctx('rp1'))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'That browser is not part of this round' })
      expect(state.writes).toHaveLength(0)
    })

    it('400s an unknown browser and a browser without vp', async () => {
      seed('qa_rounds', [seedRound({ browsers: both })])
      expect((await roundPagePatch(jsonReq({ browser: 'edge', vp: { desktop: true } }), ctx('rp1'))).status).toBe(400)
      expect((await roundPagePatch(jsonReq({ browser: 'firefox', status: 'pass' }), ctx('rp1'))).status).toBe(400)
      expect(state.writes).toHaveLength(0)
    })

    it('still 409s a closed round before anything else', async () => {
      seed('qa_rounds', [seedRound({ status: 'closed', browsers: both })])
      const res = await roundPagePatch(jsonReq({ browser: 'firefox', vp: { desktop: true } }), ctx('rp1'))
      expect(res.status).toBe(409)
      expect(state.writes).toHaveLength(0)
    })

    it('a status only patch works on any round, whatever the browsers', async () => {
      seed('qa_rounds', [seedRound({ browsers: '["firefox"]' })])
      const res = await roundPagePatch(jsonReq({ status: 'pass' }), ctx('rp1'))
      expect(res.status).toBe(200)
    })
  })

  describe('scan POST with a browser', () => {
    beforeEach(() => {
      seed('qa_round_pages', [seedRoundPage()])
      seed('qa_sites', [seedSite()])
    })

    it('stores the scan against the browser, defaulting to chromium', async () => {
      seed('qa_rounds', [seedRound({ browsers: both })])
      await scanPost(jsonReq({ viewport: 'desktop', result: cleanScan() }), ctx('rp1'))
      await scanPost(jsonReq({ viewport: 'desktop', browser: 'firefox', result: cleanScan() }), ctx('rp1'))
      const scans = writesFor('qa_scan_results').map(w => w.rows[0])
      expect(scans[0]).toMatchObject({ viewport: 'desktop', browser: 'chromium' })
      expect(scans[1]).toMatchObject({ viewport: 'desktop', browser: 'firefox' })
    })

    it('400s a browser outside the round and an unknown browser', async () => {
      seed('qa_rounds', [seedRound()])
      expect((await scanPost(jsonReq({ viewport: 'desktop', browser: 'webkit', result: cleanScan() }), ctx('rp1'))).status).toBe(400)
      expect((await scanPost(jsonReq({ viewport: 'desktop', browser: 'edge', result: cleanScan() }), ctx('rp1'))).status).toBe(400)
      expect(writesFor('qa_scan_results')).toHaveLength(0)
    })

    it('409s a closed round before it checks the browser', async () => {
      seed('qa_rounds', [seedRound({ status: 'closed' })])
      const res = await scanPost(jsonReq({ viewport: 'desktop', browser: 'webkit', result: cleanScan() }), ctx('rp1'))
      expect(res.status).toBe(409)
    })
  })

  describe('GET /api/admin/qa/round-pages/[id] with scans from several browsers', () => {
    it('keys scans by browser then viewport and merges identical issues', async () => {
      seed('qa_round_pages', [seedRoundPage()])
      seed('qa_rounds', [seedRound({ browsers: both })])
      seed('qa_sites', [seedSite()])
      const overflow = { ...cleanScan(), layout: { horizontalOverflow: true, overflowingElements: [{ selector: '.wide', width: 2000 }] } }
      const stored = JSON.stringify(normaliseScanResult(overflow))
      seed('qa_scan_results', [
        { roundPageId: 'rp1', viewport: 'desktop', browser: 'chromium', result: stored, createdAt: NOW },
        { roundPageId: 'rp1', viewport: 'desktop', browser: 'firefox', result: stored, createdAt: NOW },
        { roundPageId: 'rp1', viewport: 'tablet', browser: 'firefox', result: stored, createdAt: NOW },
      ])
      seed('qa_link_results', [])
      seed('qa_browser_ticks', [{ roundPageId: 'rp1', browser: 'firefox', viewport: 'desktop', ticked: 1 }])
      const res = await roundPageGet(getReq(), ctx('rp1'))
      expect(res.status).toBe(200)
      const json = (await res.json()) as {
        browsers: string[]
        ticks: Record<string, Record<string, boolean>>
        scans: Record<string, Record<string, unknown>>
        issues: { code: string; viewport?: string; browser?: string; browsers?: string[] }[]
      }
      expect(json.browsers).toEqual(['chromium', 'firefox'])
      expect(Object.keys(json.scans)).toEqual(['chromium', 'firefox'])
      expect(Object.keys(json.scans.firefox).sort()).toEqual(['desktop', 'tablet'])
      expect(json.ticks.firefox.desktop).toBe(true)
      const desktopOverflow = json.issues.filter(i => i.code === 'horizontal_overflow' && i.viewport === 'desktop')
      expect(desktopOverflow).toHaveLength(1)
      expect(desktopOverflow[0].browsers).toEqual(['chromium', 'firefox'])
      const tabletOverflow = json.issues.filter(i => i.code === 'horizontal_overflow' && i.viewport === 'tablet')
      expect(tabletOverflow).toHaveLength(1)
      expect(tabletOverflow[0].browsers).toEqual(['firefox'])
    })
  })
})

describe('default browser and removed browsers', () => {
  const ffOnly = '["firefox"]'

  it('ticks with no browser go to the first browser of the round', async () => {
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_rounds', [seedRound({ browsers: ffOnly })])
    seed('qa_sites', [seedSite()])
    const res = await roundPagePatch(jsonReq({ vp: { desktop: true } }), ctx('rp1'))
    expect(res.status).toBe(200)
    expect(writesFor('qa_browser_ticks')[0].rows[0]).toMatchObject({ browser: 'firefox', viewport: 'desktop', ticked: 1 })
    expect('vpDesktop' in (writesFor('qa_round_pages', 'update')[0].set ?? {})).toBe(false)
  })

  it('a scan with no browser is stored for the first browser of the round', async () => {
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_rounds', [seedRound({ browsers: ffOnly })])
    seed('qa_sites', [seedSite()])
    const res = await scanPost(jsonReq({ viewport: 'desktop', result: cleanScan() }), ctx('rp1'))
    expect(res.status).toBe(200)
    expect(writesFor('qa_scan_results')[0].rows[0]).toMatchObject({ browser: 'firefox' })
  })

  it('round-page GET hides the scans and issues of a browser removed from the round', async () => {
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_rounds', [seedRound({ browsers: '["chromium"]' })])
    seed('qa_sites', [seedSite()])
    const overflow = JSON.stringify(normaliseScanResult({ ...cleanScan(), layout: { horizontalOverflow: true, overflowingElements: [{ selector: '.w', width: 9 }] } }))
    seed('qa_scan_results', [
      { roundPageId: 'rp1', viewport: 'desktop', browser: 'chromium', result: JSON.stringify(normaliseScanResult(cleanScan())), createdAt: NOW },
      { roundPageId: 'rp1', viewport: 'desktop', browser: 'firefox', result: overflow, createdAt: NOW },
    ])
    seed('qa_link_results', [])
    const json = (await (await roundPageGet(getReq(), ctx('rp1'))).json()) as { scans: Record<string, unknown>; issues: { code: string }[] }
    expect(Object.keys(json.scans)).toEqual(['chromium'])
    expect(json.issues.some(i => i.code === 'horizontal_overflow')).toBe(false)
  })

  it('changing the browsers of a round recounts the pages that have scans in a changed browser', async () => {
    seed('qa_sites', [seedSite()])
    seed('qa_rounds', [seedRound({ browsers: '["chromium","firefox"]' })])
    seed('qa_round_pages', [seedRoundPage()])
    seed('qa_scan_results', [{ roundPageId: 'rp1', viewport: 'desktop', browser: 'firefox', result: JSON.stringify(normaliseScanResult(cleanScan())), createdAt: NOW }])
    seed('qa_link_results', [])
    const res = await roundPatch(jsonReq({ browsers: ['chromium'] }), ctx('round1'))
    expect(res.status).toBe(200)
    // The only stored scan is Firefox, now hidden, so the page counts are cleared rather than left stale.
    const cleared = writesFor('qa_round_pages', 'update').find(w => w.set && 'a11yCritical' in w.set)
    expect(cleared?.set).toMatchObject({ a11yCritical: null, perfIssues: null })
  })

  it('does not recount when only the name changes', async () => {
    seed('qa_sites', [seedSite()])
    seed('qa_rounds', [seedRound()])
    await roundPatch(jsonReq({ name: 'Renamed' }), ctx('round1'))
    expect(writesFor('qa_round_pages', 'update')).toHaveLength(0)
  })
})
