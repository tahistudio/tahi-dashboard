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
    siteChecks: null, siteChecksAt: null, redirectMap: null, redirectMapAt: null,
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
