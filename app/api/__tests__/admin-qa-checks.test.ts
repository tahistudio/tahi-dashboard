/**
 * Site QA check routes: link check, site checks, redirect map and PageSpeed.
 * Covers the admin guard on every route and the input and target rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/require-admin', () => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/qa/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qa/server')>()
  return {
    ...actual,
    loadRound: vi.fn(),
    loadRoundPage: vi.fn(),
    recomputeCounts: vi.fn(),
  }
})

import { getRequestAuth } from '@/lib/server-auth'
import { loadRound, loadRoundPage } from '@/lib/qa/server'
import { POST as checkLinksPost } from '@/app/api/admin/qa/rounds/[id]/check-links/route'
import { POST as siteChecksPost } from '@/app/api/admin/qa/rounds/[id]/site-checks/route'
import { POST as redirectMapPost } from '@/app/api/admin/qa/rounds/[id]/redirect-map/route'
import { POST as pagespeedPost } from '@/app/api/admin/qa/round-pages/[id]/pagespeed/route'

const ROUND_ID = 'round_1'
const ROUND_PAGE_ID = 'rp_1'

function jsonReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/qa/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const stagingSite = { id: 'site_1', orgId: 'org_acme', name: 'Acme', stagingUrl: 'https://acme.webflow.io', liveUrl: 'https://acme.com' }

function stagingRound() {
  return { round: { id: ROUND_ID, siteId: 'site_1', name: 'Pre-launch', target: 'staging', status: 'open' }, site: stagingSite }
}

function liveRound() {
  return { round: { id: ROUND_ID, siteId: 'site_1', name: 'Live check', target: 'live', status: 'open' }, site: stagingSite }
}

function closedRound() {
  return { round: { id: ROUND_ID, siteId: 'site_1', name: 'Done', target: 'live', status: 'closed' }, site: stagingSite }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_tahi', orgId: 'org_tahi', sessionId: 's1' })
})

describe('admin QA check routes, auth', () => {
  const cases: { name: string; run: () => Promise<Response> }[] = [
    { name: 'check-links', run: () => checkLinksPost(jsonReq({ urls: ['https://acme.com/'] }), params(ROUND_ID)) },
    { name: 'site-checks', run: () => siteChecksPost(jsonReq({}), params(ROUND_ID)) },
    { name: 'redirect-map', run: () => redirectMapPost(jsonReq({ urls: ['https://old.example/about'] }), params(ROUND_ID)) },
    { name: 'pagespeed', run: () => pagespeedPost(jsonReq({ strategy: 'mobile' }), params(ROUND_PAGE_ID)) },
  ]

  for (const c of cases) {
    it(`${c.name} 403s a non-admin caller`, async () => {
      vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client', sessionId: 's1' })
      const res = await c.run()
      expect(res.status).toBe(403)
    })
  }
})

describe('POST check-links', () => {
  it('400s when given more than 100 URLs', async () => {
    const urls = Array.from({ length: 101 }, (_, i) => `https://acme.com/p${i}`)
    const res = await checkLinksPost(jsonReq({ urls }), params(ROUND_ID))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('urls must be 1 to 100 non-empty strings')
  })

  it('409s when the round is closed', async () => {
    vi.mocked(loadRound).mockResolvedValue(closedRound() as unknown as Awaited<ReturnType<typeof loadRound>>)
    const res = await checkLinksPost(jsonReq({ urls: ['https://acme.com/'] }), params(ROUND_ID))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This round is closed' })
  })

  it('400s when given no URLs', async () => {
    const res = await checkLinksPost(jsonReq({ urls: [] }), params(ROUND_ID))
    expect(res.status).toBe(400)
  })
})

describe('POST site-checks', () => {
  it('409s when the round is closed', async () => {
    vi.mocked(loadRound).mockResolvedValue(closedRound() as unknown as Awaited<ReturnType<typeof loadRound>>)
    const res = await siteChecksPost(jsonReq({}), params(ROUND_ID))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This round is closed' })
  })
})

describe('POST redirect-map', () => {
  it('400s when given more than 150 URLs', async () => {
    const urls = Array.from({ length: 151 }, (_, i) => `https://old.example/p${i}`)
    const res = await redirectMapPost(jsonReq({ urls }), params(ROUND_ID))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('urls must be 1 to 150 non-empty strings')
  })

  it('409s when the round is closed', async () => {
    vi.mocked(loadRound).mockResolvedValue(closedRound() as unknown as Awaited<ReturnType<typeof loadRound>>)
    const res = await redirectMapPost(jsonReq({ urls: ['https://old.example/about'] }), params(ROUND_ID))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This round is closed' })
  })

  it('400s on a staging round', async () => {
    vi.mocked(loadRound).mockResolvedValue(stagingRound() as unknown as Awaited<ReturnType<typeof loadRound>>)
    const res = await redirectMapPost(jsonReq({ urls: ['https://old.example/about'] }), params(ROUND_ID))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Redirect maps run against the live site')
  })
})

describe('POST pagespeed', () => {
  it('400s on a staging round', async () => {
    vi.mocked(loadRoundPage).mockResolvedValue({
      roundPage: { id: ROUND_PAGE_ID, roundId: ROUND_ID, path: '/', pagespeed: null },
      ...stagingRound(),
    } as unknown as Awaited<ReturnType<typeof loadRoundPage>>)
    const res = await pagespeedPost(jsonReq({ strategy: 'mobile' }), params(ROUND_PAGE_ID))
    expect(res.status).toBe(400)
  })

  it('400s on an unknown strategy', async () => {
    const res = await pagespeedPost(jsonReq({ strategy: 'tablet' }), params(ROUND_PAGE_ID))
    expect(res.status).toBe(400)
  })

  it('does not reach the live check for a live round without a strategy', async () => {
    vi.mocked(loadRoundPage).mockResolvedValue({
      roundPage: { id: ROUND_PAGE_ID, roundId: ROUND_ID, path: '/', pagespeed: null },
      ...liveRound(),
    } as unknown as Awaited<ReturnType<typeof loadRoundPage>>)
    const res = await pagespeedPost(jsonReq({}), params(ROUND_PAGE_ID))
    expect(res.status).toBe(400)
  })
})

describe('POST pagespeed on a closed round', () => {
  it('409s before any work', async () => {
    vi.mocked(loadRoundPage).mockResolvedValue({
      roundPage: { id: ROUND_PAGE_ID, roundId: ROUND_ID, path: '/', pagespeed: null },
      round: { ...liveRound().round, status: 'closed' },
      site: stagingSite,
    } as unknown as Awaited<ReturnType<typeof loadRoundPage>>)
    const res = await pagespeedPost(jsonReq({ strategy: 'mobile' }), params(ROUND_PAGE_ID))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This round is closed' })
  })
})
