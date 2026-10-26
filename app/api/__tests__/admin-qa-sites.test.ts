/**
 * Site QA admin routes: sites, site detail, sitemap import, pages, page delete
 * and the view-token signer. The D1 fake returns the rows keyed by table name
 * and records inserts and updates; WHERE clauses are not evaluated, so every
 * fixture holds only the rows the handler should see.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const store = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  inserts: [] as { table: string; values: unknown }[],
  updates: [] as { table: string; set: Record<string, unknown> }[],
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn(async () => null),
}))

vi.mock('@/lib/require-admin', () => ({
  requireAdmin: vi.fn(async () => null),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { _table: 'organisations', id: 'id', name: 'name' },
    qaSites: { _table: 'qa_sites', id: 'id', orgId: 'org_id', name: 'name', archivedAt: 'archived_at', createdAt: 'created_at' },
    qaPages: { _table: 'qa_pages', id: 'id', siteId: 'site_id', path: 'path', removedAt: 'removed_at', source: 'source', groupKey: 'group_key' },
    qaRounds: { _table: 'qa_rounds', id: 'id', siteId: 'site_id', status: 'status', createdAt: 'created_at' },
    qaRoundPages: {
      _table: 'qa_round_pages', roundId: 'round_id', status: 'status', vpXl: 'vp_xl', vpDesktop: 'vp_desktop',
      vpTablet: 'vp_tablet', vpMobileL: 'vp_mobile_l', vpMobileP: 'vp_mobile_p', a11yCritical: 'a11y_critical',
      a11ySerious: 'a11y_serious', a11yModerate: 'a11y_moderate', a11yMinor: 'a11y_minor', brokenLinks: 'broken_links',
      seoIssues: 'seo_issues', launchIssues: 'launch_issues', perfIssues: 'perf_issues',
    },
  },
}))

function thenable<T>(value: T) {
  return {
    then<R1 = T, R2 = never>(resolve?: ((v: T) => R1 | PromiseLike<R1>) | null, reject?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      return Promise.resolve(value).then(resolve, reject)
    },
  }
}

function tableName(t: unknown): string {
  return (t as { _table: string })._table
}

function selectBuilder() {
  let table = ''
  const builder = {
    from(t: unknown) { table = tableName(t); return builder },
    where() { return builder },
    orderBy() { return builder },
    limit() { return builder },
    groupBy() { return builder },
    innerJoin() { return builder },
    leftJoin() { return builder },
    then<R1 = Row[], R2 = never>(resolve?: ((v: Row[]) => R1 | PromiseLike<R1>) | null, reject?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      const rows = (store.rows[table] ?? []).map(r => ({ ...r }))
      return Promise.resolve(rows).then(resolve, reject)
    },
  }
  return builder
}

const fakeDb = {
  select: vi.fn(() => selectBuilder()),
  insert: vi.fn((t: unknown) => ({
    values: (values: unknown) => {
      store.inserts.push({ table: tableName(t), values })
      return thenable([])
    },
  })),
  batch: vi.fn(async (items: PromiseLike<unknown>[]) => Promise.all(items)),
  update: vi.fn((t: unknown) => ({
    set: (set: Record<string, unknown>) => {
      store.updates.push({ table: tableName(t), set })
      return { where: () => thenable([]) }
    },
  })),
}

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { appOrigin } from '@/lib/app-url'
import { verifyViewToken } from '@/lib/qa/token'
import { NextRequest, NextResponse } from 'next/server'
import { GET as listSites, POST as createSite } from '@/app/api/admin/qa/sites/route'
import { GET as getSite, PATCH as patchSite, DELETE as archiveSite } from '@/app/api/admin/qa/sites/[id]/route'
import { POST as importSitemap } from '@/app/api/admin/qa/sites/[id]/import-sitemap/route'
import { POST as addPage } from '@/app/api/admin/qa/sites/[id]/pages/route'
import { DELETE as removePage } from '@/app/api/admin/qa/pages/[id]/route'
import { POST as viewToken } from '@/app/api/admin/qa/view-token/route'

const TAHI = { userId: 'user_tahi', orgId: 'org_tahi', sessionId: 's1' }
const CLIENT = { userId: 'user_client', orgId: 'org_client', sessionId: 's2' }
const VIEW_ORIGIN = 'https://qa-view.example.workers.dev'
const SECRET = 'test-secret-value'

function jsonReq(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/qa${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function inserted(table: string): unknown[] {
  return store.inserts
    .filter(i => i.table === table)
    .flatMap(i => (Array.isArray(i.values) ? i.values : [i.values]))
}

function site(overrides: Row = {}): Row {
  return {
    id: 'site_1',
    orgId: 'org_acme',
    name: 'Acme',
    stagingUrl: 'https://acme.webflow.io',
    liveUrl: null,
    notes: null,
    createdBy: 'user_tahi',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

const savedEnv = {
  QA_VIEW_SECRET: process.env.QA_VIEW_SECRET,
  NEXT_PUBLIC_QA_VIEW_ORIGIN: process.env.NEXT_PUBLIC_QA_VIEW_ORIGIN,
}

beforeEach(() => {
  vi.clearAllMocks()
  store.rows = {}
  store.inserts = []
  store.updates = []
  vi.mocked(db).mockResolvedValue(fakeDb as unknown as Awaited<ReturnType<typeof db>>)
  vi.mocked(getRequestAuth).mockResolvedValue(TAHI)
  vi.mocked(requireFeature).mockResolvedValue(null)
  vi.mocked(requireAdmin).mockResolvedValue(null)
  process.env.QA_VIEW_SECRET = SECRET
  process.env.NEXT_PUBLIC_QA_VIEW_ORIGIN = VIEW_ORIGIN
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('Site QA routes: admin guard', () => {
  const cases: [string, () => Promise<Response>][] = [
    ['GET sites', () => listSites(jsonReq('GET', '/sites'))],
    ['POST sites', () => createSite(jsonReq('POST', '/sites', { orgId: 'org_acme', name: 'Acme', stagingUrl: 'https://acme.webflow.io' }))],
    ['GET sites/[id]', () => getSite(jsonReq('GET', '/sites/site_1'), ctx('site_1'))],
    ['PATCH sites/[id]', () => patchSite(jsonReq('PATCH', '/sites/site_1', { name: 'X' }), ctx('site_1'))],
    ['DELETE sites/[id]', () => archiveSite(jsonReq('DELETE', '/sites/site_1'), ctx('site_1'))],
    ['POST import-sitemap', () => importSitemap(jsonReq('POST', '/sites/site_1/import-sitemap', { target: 'staging' }), ctx('site_1'))],
    ['POST sites/[id]/pages', () => addPage(jsonReq('POST', '/sites/site_1/pages', { path: '/about' }), ctx('site_1'))],
    ['DELETE pages/[id]', () => removePage(jsonReq('DELETE', '/pages/page_1'), ctx('page_1'))],
    ['POST view-token', () => viewToken(jsonReq('POST', '/view-token', { siteId: 'site_1', target: 'staging' }))],
  ]

  it.each(cases)('%s returns 403 for a non-Tahi org', async (_name, call) => {
    vi.mocked(getRequestAuth).mockResolvedValue(CLIENT)
    const res = await call()
    expect(res.status).toBe(403)
  })

  it.each(cases)('%s returns 403 for a signed-out caller', async (_name, call) => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null, sessionId: null })
    const res = await call()
    expect(res.status).toBe(403)
  })

  it('passes a feature denial straight through', async () => {
    vi.mocked(requireFeature).mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await listSites(jsonReq('GET', '/sites'))
    expect(res.status).toBe(403)
    expect(requireFeature).toHaveBeenCalledWith({ userId: 'user_tahi', orgId: 'org_tahi' }, 'qa_tester')
  })

  it('passes an admin denial straight through', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await createSite(jsonReq('POST', '/sites', { orgId: 'org_acme', name: 'Acme', stagingUrl: 'https://acme.webflow.io' }))
    expect(res.status).toBe(403)
    expect(store.inserts).toHaveLength(0)
  })
})

describe('GET /api/admin/qa/sites', () => {
  it('returns the open round with ticks, failing and issue totals, and the client name', async () => {
    store.rows = {
      organisations: [{ id: 'org_acme', name: 'Acme Ltd' }],
      qa_sites: [site()],
      qa_rounds: [
        { id: 'round_old', siteId: 'site_1', name: 'Old', target: 'staging', status: 'open', createdAt: '2026-10-01T00:00:00.000Z' },
        { id: 'round_new', siteId: 'site_1', name: 'Pre-launch 26 Oct', target: 'staging', status: 'open', createdAt: '2026-10-20T00:00:00.000Z' },
      ],
      qa_round_pages: [
        { roundId: 'round_new', pageCount: 4, ticksDone: 13, failing: 2, issues: 7 },
      ],
    }
    const res = await listSites(jsonReq('GET', '/sites'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: Row[] }
    expect(json.items).toHaveLength(1)
    expect(json.items[0].orgName).toBe('Acme Ltd')
    expect(json.items[0].openRound).toEqual({
      id: 'round_new', name: 'Pre-launch 26 Oct', target: 'staging',
      ticksDone: 13, ticksTotal: 20, failing: 2, issues: 7,
    })
  })

  it('returns openRound null when the site has no open round', async () => {
    store.rows = { organisations: [{ id: 'org_acme', name: 'Acme Ltd' }], qa_sites: [site()], qa_rounds: [] }
    const json = (await (await listSites(jsonReq('GET', '/sites'))).json()) as { items: Row[] }
    expect(json.items[0].openRound).toBeNull()
  })
})

describe('POST /api/admin/qa/sites', () => {
  beforeEach(() => {
    store.rows = { organisations: [{ id: 'org_acme', name: 'Acme Ltd' }] }
  })

  it('returns 400 when no URL is given', async () => {
    const res = await createSite(jsonReq('POST', '/sites', { orgId: 'org_acme', name: 'Acme' }))
    expect(res.status).toBe(400)
    expect(store.inserts).toHaveLength(0)
  })

  it('returns 400 for a loopback address', async () => {
    const res = await createSite(jsonReq('POST', '/sites', { orgId: 'org_acme', name: 'Acme', stagingUrl: 'http://127.0.0.1' }))
    expect(res.status).toBe(400)
    expect(store.inserts).toHaveLength(0)
  })

  it('stores the origin only, never the path', async () => {
    const res = await createSite(jsonReq('POST', '/sites', {
      orgId: 'org_acme', name: 'Acme', stagingUrl: 'https://acme.webflow.io/some/path',
    }))
    expect(res.status).toBe(201)
    const rows = inserted('qa_sites') as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0].stagingUrl).toBe('https://acme.webflow.io')
    expect(rows[0].liveUrl).toBeNull()
    expect(rows[0].orgId).toBe('org_acme')
  })

  it('returns 400 when the client does not exist', async () => {
    store.rows = { organisations: [] }
    const res = await createSite(jsonReq('POST', '/sites', { orgId: 'org_missing', name: 'Acme', stagingUrl: 'https://acme.webflow.io' }))
    expect(res.status).toBe(400)
    expect(store.inserts).toHaveLength(0)
  })
})

describe('GET /api/admin/qa/sites/[id]', () => {
  it('returns 404 for an unknown site', async () => {
    store.rows = { qa_sites: [] }
    const res = await getSite(jsonReq('GET', '/sites/nope'), ctx('nope'))
    expect(res.status).toBe(404)
  })

  it('lists active pages first by path, then removed pages', async () => {
    store.rows = {
      organisations: [{ id: 'org_acme', name: 'Acme Ltd' }],
      qa_sites: [site()],
      qa_pages: [
        { id: 'p1', siteId: 'site_1', path: '/z', removedAt: null },
        { id: 'p2', siteId: 'site_1', path: '/a', removedAt: '2026-10-10T00:00:00.000Z' },
        { id: 'p3', siteId: 'site_1', path: '/b', removedAt: null },
      ],
      qa_rounds: [],
    }
    const json = (await (await getSite(jsonReq('GET', '/sites/site_1'), ctx('site_1'))).json()) as { pages: Row[] }
    expect(json.pages.map(p => p.path)).toEqual(['/b', '/z', '/a'])
  })
})

describe('PATCH and DELETE /api/admin/qa/sites/[id]', () => {
  it('refuses to clear both URLs', async () => {
    store.rows = { organisations: [{ id: 'org_acme', name: 'Acme Ltd' }], qa_sites: [site()] }
    const res = await patchSite(jsonReq('PATCH', '/sites/site_1', { stagingUrl: null }), ctx('site_1'))
    expect(res.status).toBe(400)
    expect(store.updates).toHaveLength(0)
  })

  it('updates only the fields sent', async () => {
    store.rows = { organisations: [{ id: 'org_acme', name: 'Acme Ltd' }], qa_sites: [site()] }
    const res = await patchSite(jsonReq('PATCH', '/sites/site_1', { name: 'Acme 2' }), ctx('site_1'))
    expect(res.status).toBe(200)
    expect(store.updates).toHaveLength(1)
    expect(store.updates[0].set.name).toBe('Acme 2')
    expect(store.updates[0].set).not.toHaveProperty('stagingUrl')
  })

  it('archives the site (sets archivedAt, no row delete)', async () => {
    store.rows = { qa_sites: [site()] }
    const res = await archiveSite(jsonReq('DELETE', '/sites/site_1'), ctx('site_1'))
    expect(await res.json()).toEqual({ ok: true })
    expect(typeof store.updates[0].set.archivedAt).toBe('string')
  })
})

describe('POST /api/admin/qa/sites/[id]/import-sitemap', () => {
  const urlset = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://acme.webflow.io/about</loc></url>
  <url><loc>https://acme.webflow.io/contact</loc></url>
</urlset>`

  beforeEach(() => {
    store.rows = { qa_sites: [site()], qa_pages: [] }
  })

  it('inserts the home page and every sitemap path', async () => {
    const fetchMock = vi.fn<(input: string) => Promise<Response>>(async () => new Response(urlset, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await importSitemap(jsonReq('POST', '/sites/site_1/import-sitemap', { target: 'staging' }), ctx('site_1'))
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe('https://acme.webflow.io/sitemap.xml')
    const paths = (inserted('qa_pages') as Row[]).map(r => r.path)
    expect(paths).toEqual(expect.arrayContaining(['/', '/about', '/contact']))
    expect(paths).toHaveLength(3)
    expect(await res.json()).toEqual({ added: 3, updated: 0, removed: 0, total: 3, truncated: false })
  })

  it('returns 502 when sitemap.xml cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const res = await importSitemap(jsonReq('POST', '/sites/site_1/import-sitemap', { target: 'staging' }), ctx('site_1'))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Could not read sitemap.xml' })
    expect(store.inserts).toHaveLength(0)
  })

  it('flags a sitemap page removed when it leaves the sitemap, but never a manual page', async () => {
    store.rows = {
      qa_sites: [site()],
      qa_pages: [
        { id: 'p_gone', siteId: 'site_1', path: '/gone', source: 'sitemap', removedAt: null, groupKey: null },
        { id: 'p_manual', siteId: 'site_1', path: '/manual', source: 'manual', removedAt: null, groupKey: null },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(urlset, { status: 200 })))
    const res = await importSitemap(jsonReq('POST', '/sites/site_1/import-sitemap', { target: 'staging' }), ctx('site_1'))
    const json = (await res.json()) as { removed: number; total: number }
    expect(json.removed).toBe(1)
    const removals = store.updates.filter(u => u.set.removedAt !== undefined && u.set.removedAt !== null)
    expect(removals).toHaveLength(1)
    expect(json.total).toBe(4)
  })

  it('groups regroup updates by groupKey into batched id lists', async () => {
    const many = Array.from({ length: 100 }, (_, i) => `<url><loc>https://acme.webflow.io/blog/p${i}</loc></url>`).join('')
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${many}</urlset>`
    store.rows = {
      qa_sites: [site()],
      qa_pages: Array.from({ length: 100 }, (_, i) => ({
        id: `p${i}`, siteId: 'site_1', path: `/blog/p${i}`, source: 'sitemap', removedAt: null, groupKey: null,
      })),
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xml, { status: 200 })))
    const res = await importSitemap(jsonReq('POST', '/sites/site_1/import-sitemap', { target: 'staging' }), ctx('site_1'))
    expect(res.status).toBe(200)
    const regroups = store.updates.filter(u => u.set.groupKey !== undefined)
    // 100 rows in one group are 2 statements (90 + 10), not 100 per-row updates
    expect(regroups).toHaveLength(2)
    expect(regroups.every(u => u.set.groupKey === '/blog/*')).toBe(true)
    expect(fakeDb.batch).toHaveBeenCalledTimes(1)
  })

  it('does not flag pages removed when the sitemap read is truncated', async () => {
    store.rows = {
      qa_sites: [site()],
      qa_pages: [{ id: 'p_gone', siteId: 'site_1', path: '/gone', source: 'sitemap', removedAt: null, groupKey: null }],
    }
    const child = `<urlset>${'<url><loc>https://acme.webflow.io/a</loc></url>'.repeat(10)}</urlset>`
    const index = `<sitemapindex>${Array.from({ length: 7 }, (_, i) => `<sitemap><loc>https://acme.webflow.io/s${i}.xml</loc></sitemap>`).join('')}</sitemapindex>`
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('/sitemap.xml') ? index : child, { status: 200 })))
    const res = await importSitemap(jsonReq('POST', '/sites/site_1/import-sitemap', { target: 'staging' }), ctx('site_1'))
    const json = (await res.json()) as { removed: number; truncated: boolean }
    expect(json.truncated).toBe(true)
    expect(json.removed).toBe(0)
    expect(store.updates.some(u => u.set.removedAt)).toBe(false)
  })

  it('returns 400 when the site has no URL for the requested target', async () => {
    const res = await importSitemap(jsonReq('POST', '/sites/site_1/import-sitemap', { target: 'live' }), ctx('site_1'))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/admin/qa/sites/[id]/pages', () => {
  it('returns 409 when the path already exists and is active', async () => {
    store.rows = { qa_sites: [site()], qa_pages: [{ id: 'p1', siteId: 'site_1', path: '/about', removedAt: null }] }
    const res = await addPage(jsonReq('POST', '/sites/site_1/pages', { path: '/about/' }), ctx('site_1'))
    expect(res.status).toBe(409)
  })

  it('restores a removed page instead of inserting a duplicate', async () => {
    store.rows = { qa_sites: [site()], qa_pages: [{ id: 'p2', siteId: 'site_1', path: '/old', removedAt: '2026-10-10T00:00:00.000Z' }] }
    const res = await addPage(jsonReq('POST', '/sites/site_1/pages', { path: '/old' }), ctx('site_1'))
    expect(res.status).toBe(200)
    expect(store.updates[0].set.removedAt).toBeNull()
    expect(inserted('qa_pages')).toHaveLength(0)
  })

  it('inserts a manual page with source manual', async () => {
    store.rows = { qa_sites: [site()], qa_pages: [] }
    const res = await addPage(jsonReq('POST', '/sites/site_1/pages', { path: '/new' }), ctx('site_1'))
    expect(res.status).toBe(201)
    const rows = inserted('qa_pages') as Row[]
    expect(rows[0].source).toBe('manual')
    expect(rows[0].path).toBe('/new')
  })

  it('returns 400 for an empty path', async () => {
    store.rows = { qa_sites: [site()], qa_pages: [] }
    const res = await addPage(jsonReq('POST', '/sites/site_1/pages', { path: '' }), ctx('site_1'))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/admin/qa/pages/[id]', () => {
  it('returns 404 for an unknown page', async () => {
    store.rows = { qa_pages: [] }
    const res = await removePage(jsonReq('DELETE', '/pages/nope'), ctx('nope'))
    expect(res.status).toBe(404)
  })

  it('sets removedAt and keeps the row', async () => {
    store.rows = { qa_pages: [{ id: 'page_1', path: '/about', removedAt: null }] }
    const res = await removePage(jsonReq('DELETE', '/pages/page_1'), ctx('page_1'))
    expect(await res.json()).toEqual({ ok: true })
    expect(typeof store.updates[0].set.removedAt).toBe('string')
  })
})

describe('POST /api/admin/qa/view-token', () => {
  beforeEach(() => {
    store.rows = { qa_sites: [site({ liveUrl: 'https://www.acme.com' })] }
  })

  it('returns 503 when QA_VIEW_SECRET is unset', async () => {
    delete process.env.QA_VIEW_SECRET
    const res = await viewToken(jsonReq('POST', '/view-token', { siteId: 'site_1', target: 'staging' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'QA viewer not configured' })
  })

  it('returns 503 when NEXT_PUBLIC_QA_VIEW_ORIGIN is unset', async () => {
    delete process.env.NEXT_PUBLIC_QA_VIEW_ORIGIN
    const res = await viewToken(jsonReq('POST', '/view-token', { siteId: 'site_1', target: 'staging' }))
    expect(res.status).toBe(503)
  })

  it('signs a token for the stored origin, ignoring any origin in the body', async () => {
    const res = await viewToken(jsonReq('POST', '/view-token', {
      siteId: 'site_1', target: 'staging', origin: 'https://evil.example',
    }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { token: string; baseUrl: string; expiresAt: string }
    expect(json.baseUrl.startsWith(`${VIEW_ORIGIN}/v/`)).toBe(true)
    expect(json.baseUrl).toBe(`${VIEW_ORIGIN}/v/${json.token}`)
    const payload = await verifyViewToken(json.token, SECRET)
    expect(payload).not.toBeNull()
    expect(payload?.o).toBe('https://acme.webflow.io')
    expect(payload?.p).toBe(appOrigin())
    const nowSeconds = Math.floor(Date.now() / 1000)
    expect(payload?.exp ?? 0).toBeGreaterThan(nowSeconds)
    expect(Date.parse(json.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('does not verify with the wrong secret', async () => {
    const res = await viewToken(jsonReq('POST', '/view-token', { siteId: 'site_1', target: 'staging' }))
    const json = (await res.json()) as { token: string }
    expect(await verifyViewToken(json.token, 'another-secret')).toBeNull()
  })

  it('returns 400 when the site has no URL for the target', async () => {
    store.rows = { qa_sites: [site({ stagingUrl: null, liveUrl: 'https://www.acme.com' })] }
    const res = await viewToken(jsonReq('POST', '/view-token', { siteId: 'site_1', target: 'staging' }))
    expect(res.status).toBe(400)
  })
})
