/**
 * Site QA, Task 11: issue to request (POST round-pages/[id]/create-request)
 * and the round report data (GET rounds/[id]/report).
 *
 * Guard order, body handling and the internal flag are the contract under
 * test. The site org always comes from the stored site, never the body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import type { SQL } from 'drizzle-orm'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn(async () => null) }))
vi.mock('@/lib/require-admin', () => ({ requireAdmin: vi.fn(async () => null) }))

vi.mock('@/lib/request-writes', () => ({ createRequestRecord: vi.fn() }))

vi.mock('@/lib/qa/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qa/server')>()
  return { ...actual, loadRoundPage: vi.fn(), loadRound: vi.fn() }
})

const updateSet = vi.fn()
const updateWhere = vi.fn(async () => undefined)
updateSet.mockImplementation(() => ({ where: updateWhere }))

// Chain for the report route's two reads: .limit(1) (org name) and
// .orderBy(...) (round pages). Rows are set per test.
let orgRows: { name: string }[] = []
let pageRows: unknown[] = []
// Rows of the comments join ({ comment }), also set per test.
let commentRows: { comment: unknown }[] = []

vi.mock('@/lib/db', () => ({
  db: vi.fn(async () => ({
    update: vi.fn(() => ({ set: updateSet })),
    select: vi.fn((cols?: Record<string, unknown>) => {
      const isCommentJoin = cols !== undefined && 'comment' in cols
      const chain: Record<string, unknown> = {}
      chain.from = vi.fn(() => chain)
      chain.innerJoin = vi.fn(() => chain)
      chain.where = vi.fn(() => chain)
      chain.limit = vi.fn(async () => orgRows)
      chain.orderBy = vi.fn(async () => (isCommentJoin ? commentRows : pageRows))
      return chain
    }),
  })),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    qaRoundPages: { id: 'id', roundId: 'round_id', sortOrder: 'sort_order', requestIds: 'request_ids' },
    organisations: { id: 'id', name: 'name' },
    qaComments: { id: 'id', roundPageId: 'round_page_id', createdAt: 'created_at' },
  },
}))

import { POST } from '@/app/api/admin/qa/round-pages/[id]/create-request/route'
import { GET } from '@/app/api/admin/qa/rounds/[id]/report/route'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { createRequestRecord } from '@/lib/request-writes'
import { loadRoundPage, loadRound } from '@/lib/qa/server'

const SITE = {
  id: 'site_1',
  orgId: 'org_client_1',
  name: 'Acme',
  stagingUrl: 'https://acme-staging.webflow.io',
  liveUrl: 'https://acme.example.com',
}

const ROUND = {
  id: 'round_1',
  siteId: 'site_1',
  name: 'Pre-launch 26 Oct',
  target: 'staging',
  status: 'open',
  createdAt: '2026-10-20T00:00:00.000Z',
  closedAt: null,
  siteChecks: null,
  siteChecksAt: null,
  redirectMap: null,
  redirectMapAt: null,
}

const ROUND_PAGE = {
  id: 'rp_1',
  roundId: 'round_1',
  pageId: 'page_1',
  path: '/about',
  status: 'fail',
  requestIds: JSON.stringify(['req_0']),
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/qa/round-pages/rp_1/create-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/qa/rounds/round_1/report')
}

const createParams = (id = 'rp_1') => ({ params: Promise.resolve({ id }) })
const reportParams = (id = 'round_1') => ({ params: Promise.resolve({ id }) })

describe('POST /api/admin/qa/round-pages/[id]/create-request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' } as never)
    vi.mocked(isTahiAdmin).mockImplementation((orgId: string | null) => orgId === 'org_tahi')
    vi.mocked(requireFeature).mockResolvedValue(null)
    vi.mocked(requireAdmin).mockResolvedValue(null)
    vi.mocked(loadRoundPage).mockResolvedValue({ roundPage: { ...ROUND_PAGE }, round: { ...ROUND }, site: { ...SITE } } as never)
    vi.mocked(createRequestRecord).mockResolvedValue({
      ok: true,
      request: { id: 'req_1' },
    } as never)
  })

  it('returns 403 for a caller that is not a Tahi admin', async () => {
    vi.mocked(isTahiAdmin).mockReturnValueOnce(false)
    const res = await POST(postRequest({ title: 'Broken hero' }), createParams())
    expect(res.status).toBe(403)
    expect(createRequestRecord).not.toHaveBeenCalled()
  })

  it('returns the feature gate response when qa_tester is denied', async () => {
    vi.mocked(requireFeature).mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(postRequest({ title: 'Broken hero' }), createParams())
    expect(res.status).toBe(403)
    expect(requireFeature).toHaveBeenCalledWith({ userId: 'user_admin', orgId: 'org_tahi' }, 'qa_tester')
    expect(createRequestRecord).not.toHaveBeenCalled()
  })

  it('returns the admin gate response when requireAdmin denies', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(postRequest({ title: 'Broken hero' }), createParams())
    expect(res.status).toBe(403)
    expect(createRequestRecord).not.toHaveBeenCalled()
  })

  it('rejects a body that is not a JSON object with 400', async () => {
    const res = await POST(postRequest('not json'), createParams())
    expect(res.status).toBe(400)
    expect(createRequestRecord).not.toHaveBeenCalled()
  })

  it('rejects a missing or over-long title with 400', async () => {
    expect((await POST(postRequest({ title: '   ' }), createParams())).status).toBe(400)
    expect((await POST(postRequest({ title: 'x'.repeat(201) }), createParams())).status).toBe(400)
    expect(createRequestRecord).not.toHaveBeenCalled()
  })

  it('rejects an over-long description and an unknown viewport with 400', async () => {
    expect((await POST(postRequest({ title: 'T', description: 'd'.repeat(4001) }), createParams())).status).toBe(400)
    expect((await POST(postRequest({ title: 'T', viewport: 'watch' }), createParams())).status).toBe(400)
    expect(createRequestRecord).not.toHaveBeenCalled()
  })

  it('returns 404 when the round page does not exist', async () => {
    vi.mocked(loadRoundPage).mockResolvedValueOnce(null)
    const res = await POST(postRequest({ title: 'T' }), createParams('missing'))
    expect(res.status).toBe(404)
    expect(createRequestRecord).not.toHaveBeenCalled()
  })

  it('builds an internal request against the site org, ignoring any clientOrgId in the body', async () => {
    const res = await POST(
      postRequest({ title: '  Broken hero  ', description: 'Logo is cut off', viewport: 'mobile_p', clientOrgId: 'org_other' }),
      createParams(),
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ requestId: 'req_1' })

    expect(createRequestRecord).toHaveBeenCalledTimes(1)
    const [, input, actor] = vi.mocked(createRequestRecord).mock.calls[0]
    expect(input.clientOrgId).toBe('org_client_1')
    expect(input.isInternal).toBe(true)
    expect(input.title).toBe('Broken hero')
    expect(input.description).toBe(
      'Logo is cut off\n\nPage: https://acme-staging.webflow.io/about\nViewport: Mobile P (375px)\nFrom QA round: Pre-launch 26 Oct',
    )
    expect(actor).toEqual({ actorType: 'team_member', actorId: 'user_admin' })
  })

  it('omits the viewport line when no viewport is given and uses the live origin for a live round', async () => {
    vi.mocked(loadRoundPage).mockResolvedValueOnce({
      roundPage: { ...ROUND_PAGE, requestIds: null },
      round: { ...ROUND, target: 'live' },
      site: { ...SITE },
    } as never)
    const res = await POST(postRequest({ title: 'Stale footer' }), createParams())
    expect(res.status).toBe(201)
    const [, input] = vi.mocked(createRequestRecord).mock.calls[0]
    expect(input.description).toBe('Page: https://acme.example.com/about\nFrom QA round: Pre-launch 26 Oct')
  })

  it('appends the new request id to request_ids on the round page', async () => {
    await POST(postRequest({ title: 'Broken hero' }), createParams())
    expect(updateSet).toHaveBeenCalledTimes(1)
    const payload = updateSet.mock.calls[0][0] as { requestIds: SQL; updatedAt: string }
    const built = new SQLiteSyncDialect().sqlToQuery(payload.requestIds)
    expect(built.sql).toContain('json_insert(coalesce(')
    expect(built.sql).toContain("'$[#]'")
    expect(built.params).toEqual(['request_ids', 'req_1'])
    expect(typeof payload.updatedAt).toBe('string')
    expect(updateWhere).toHaveBeenCalledTimes(1)
  })

  it('returns 409 and creates nothing when the round is closed', async () => {
    vi.mocked(loadRoundPage).mockResolvedValue({
      roundPage: { ...ROUND_PAGE }, round: { ...ROUND, status: 'closed' }, site: { ...SITE },
    } as never)
    const res = await POST(postRequest({ title: 'Broken hero' }), createParams())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This round is closed' })
    expect(createRequestRecord).not.toHaveBeenCalled()
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('passes through the failure from createRequestRecord and does not link anything', async () => {
    vi.mocked(createRequestRecord).mockResolvedValueOnce({
      ok: false,
      failure: { status: 403, error: 'No access to this client' },
    } as never)
    const res = await POST(postRequest({ title: 'Broken hero' }), createParams())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'No access to this client' })
    expect(updateSet).not.toHaveBeenCalled()
  })
})

interface ReportBody {
  orgName: string | null
  site: { orgId: string }
  round: { name: string }
  siteChecks: unknown
  redirectMap: unknown
  totals: Record<string, number>
  comments: { roundPageId: string; path: string | null; n: number; body: string; status: string }[]
  commentCounts: { open: number; resolved: number }
  pages: { ticks: Record<string, boolean>; counts: Record<string, number> | null; note: string | null; requestIds: string[] }[]
}

describe('GET /api/admin/qa/rounds/[id]/report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' } as never)
    vi.mocked(isTahiAdmin).mockImplementation((orgId: string | null) => orgId === 'org_tahi')
    vi.mocked(requireFeature).mockResolvedValue(null)
    vi.mocked(requireAdmin).mockResolvedValue(null)
    vi.mocked(loadRound).mockResolvedValue({
      round: { ...ROUND, siteChecks: JSON.stringify([{ code: 'robots', result: 'pass', detail: 'ok' }]), redirectMap: null },
      site: { ...SITE },
    } as never)
    orgRows = [{ name: 'Acme Ltd' }]
    commentRows = []
    pageRows = [
      {
        id: 'rp_1', path: '/', status: 'pass', note: null, requestIds: null,
        vpXl: 1, vpDesktop: 1, vpTablet: 1, vpMobileL: 1, vpMobileP: 1,
        a11yCritical: 0, a11ySerious: 1, a11yModerate: 0, a11yMinor: 2,
        brokenLinks: 0, seoIssues: 0, launchIssues: 0, perfIssues: 0,
      },
      {
        id: 'rp_2', path: '/about', status: 'fail', note: 'Hero overflows', requestIds: JSON.stringify(['req_9']),
        vpXl: 1, vpDesktop: 0, vpTablet: 0, vpMobileL: 0, vpMobileP: 1,
        a11yCritical: 1, a11ySerious: 0, a11yModerate: 0, a11yMinor: 0,
        brokenLinks: 2, seoIssues: 3, launchIssues: 0, perfIssues: 1,
      },
      {
        id: 'rp_3', path: '/contact', status: 'untested', note: null, requestIds: null,
        vpXl: 0, vpDesktop: 0, vpTablet: 0, vpMobileL: 0, vpMobileP: 0,
        a11yCritical: null, a11ySerious: null, a11yModerate: null, a11yMinor: null,
        brokenLinks: null, seoIssues: null, launchIssues: null, perfIssues: null,
      },
    ]
  })

  it('returns 403 for a caller that is not a Tahi admin', async () => {
    vi.mocked(isTahiAdmin).mockReturnValue(false)
    const res = await GET(getRequest(), reportParams())
    expect(res.status).toBe(403)
    expect(loadRound).not.toHaveBeenCalled()
  })

  it('returns the admin gate response when requireAdmin denies', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await GET(getRequest(), reportParams())
    expect(res.status).toBe(403)
  })

  it('returns 404 when the round does not exist', async () => {
    vi.mocked(loadRound).mockResolvedValueOnce(null)
    const res = await GET(getRequest(), reportParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns totals, per-page rows and parsed site checks', async () => {
    const res = await GET(getRequest(), reportParams())
    expect(res.status).toBe(200)
    const body = (await res.json()) as ReportBody

    expect(body.orgName).toBe('Acme Ltd')
    expect(body.site.orgId).toBe('org_client_1')
    expect(body.round.name).toBe('Pre-launch 26 Oct')
    expect(body.siteChecks).toEqual([{ code: 'robots', result: 'pass', detail: 'ok' }])
    expect(body.redirectMap).toBeNull()

    expect(body.totals).toEqual({
      pages: 3,
      ticksDone: 7,
      ticksTotal: 15,
      pass: 1,
      fail: 1,
      untested: 1,
      a11yCritical: 1,
      a11ySerious: 1,
      brokenLinks: 2,
      seoIssues: 3,
      launchIssues: 0,
      perfIssues: 1,
    })

    expect(body.pages).toHaveLength(3)
    expect(body.pages[0].ticks).toEqual({ xl: true, desktop: true, tablet: true, mobile_l: true, mobile_p: true })
    expect(body.pages[0].counts).toEqual({
      a11yCritical: 0, a11ySerious: 1, a11yModerate: 0, a11yMinor: 2,
      brokenLinks: 0, seoIssues: 0, launchIssues: 0, perfIssues: 0,
    })
    expect(body.pages[1].requestIds).toEqual(['req_9'])
    expect(body.pages[1].note).toBe('Hero overflows')
    expect(body.pages[2].counts).toBeNull()
    expect(body.pages[2].requestIds).toEqual([])
    expect(body.comments).toEqual([])
    expect(body.commentCounts).toEqual({ open: 0, resolved: 0 })
  })

  it('returns comments open before resolved per page, with pin numbers and counts', async () => {
    const base = {
      viewport: 'desktop', selector: 'h1', ox: 0.5, oy: 0.5, elementTag: 'h1', elementText: 'Hi',
      authorName: 'Liam', updatedAt: '', resolvedAt: null,
    }
    // Pin numbers follow created_at per page: c_a is pin 1 on rp_2 (resolved), c_b is pin 2 (open).
    commentRows = [
      { comment: { ...base, id: 'c_a', roundPageId: 'rp_2', body: 'Old issue', status: 'resolved', createdAt: '2026-10-20T01:00:00.000Z' } },
      { comment: { ...base, id: 'c_b', roundPageId: 'rp_2', body: 'New issue', status: 'open', createdAt: '2026-10-20T02:00:00.000Z' } },
    ]
    const res = await GET(getRequest(), reportParams())
    const body = (await res.json()) as ReportBody
    expect(body.commentCounts).toEqual({ open: 1, resolved: 1 })
    expect(body.comments.map(c => [c.body, c.status, c.n, c.path])).toEqual([
      ['New issue', 'open', 2, '/about'],
      ['Old issue', 'resolved', 1, '/about'],
    ])
  })
})
