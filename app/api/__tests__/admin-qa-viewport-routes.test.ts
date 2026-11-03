/**
 * Site QA viewport sets (SQA.8, T5b): the scan POST and the comments POST check the
 * viewport against the registry before any read, then against the round's set
 * after the closed 409 and the browser 400. A legacy round (viewports NULL) keeps
 * the five legacy keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn(async () => null) }))
vi.mock('@/lib/require-admin', () => ({ requireAdmin: vi.fn(async () => null) }))
vi.mock('@/lib/qa/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qa/server')>()
  return { ...actual, loadRoundPage: vi.fn(), recomputeCounts: vi.fn(async () => undefined) }
})

const scanUpserts: Record<string, unknown>[] = []
const commentInserts: Record<string, unknown>[] = []
const dbCalls = vi.fn()

vi.mock('@/lib/db', () => ({
  db: vi.fn(async () => {
    dbCalls()
    return {
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {}
        chain.from = vi.fn(() => chain)
        chain.where = vi.fn(() => chain)
        chain.limit = vi.fn(async () => [{ name: 'Liam', a11yCritical: 0, a11ySerious: 0, a11yModerate: 0, a11yMinor: 0, brokenLinks: 0, seoIssues: 0, launchIssues: 0, perfIssues: 0 }])
        return chain
      }),
      insert: vi.fn((table: { __name?: string }) => ({
        values: vi.fn((v: Record<string, unknown>) => {
          if (table.__name === 'scan') {
            scanUpserts.push(v)
            return { onConflictDoUpdate: vi.fn(async () => undefined) }
          }
          commentInserts.push(v)
          return { returning: vi.fn(async () => [{ ...v }]) }
        }),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    }
  }),
}))
vi.mock('@/db/d1', () => ({
  schema: {
    qaScanResults: { __name: 'scan', roundPageId: 'round_page_id', viewport: 'viewport', browser: 'browser' },
    qaRoundPages: { id: 'id' },
    qaComments: { __name: 'comment', roundPageId: 'round_page_id', createdAt: 'created_at', id: 'id' },
    teamMembers: { name: 'name', clerkUserId: 'clerk_user_id' },
  },
}))

import { POST as scanPost } from '@/app/api/admin/qa/round-pages/[id]/scan/route'
import { POST as commentPost } from '@/app/api/admin/qa/round-pages/[id]/comments/route'
import { loadRoundPage } from '@/lib/qa/server'

const params = { params: Promise.resolve({ id: 'rp_1' }) }

const CORE_SET = JSON.stringify(['phone_s', 'phone_m', 'tablet_portrait', 'laptop_m', 'desktop_fhd'])
const CORE_LIST = 'phone_s, phone_m, tablet_portrait, laptop_m, desktop_fhd'

function roundWith(overrides: Record<string, unknown>): void {
  vi.mocked(loadRoundPage).mockResolvedValue({
    roundPage: { id: 'rp_1', path: '/' },
    round: { id: 'r_1', status: 'open', browsers: '["chromium"]', viewports: null, ...overrides },
    site: { id: 's_1' },
  } as unknown as Awaited<ReturnType<typeof loadRoundPage>>)
}

function scanRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/qa/round-pages/rp_1/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function commentRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/qa/round-pages/rp_1/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const comment = { selector: 'h1', ox: 0.5, oy: 0.5, body: 'Too low' }

beforeEach(() => {
  scanUpserts.length = 0
  commentInserts.length = 0
  dbCalls.mockClear()
  vi.mocked(loadRoundPage).mockReset()
  roundWith({})
})

describe('viewport sets: scan POST', () => {
  it('refuses a viewport outside a core round and names the round keys', async () => {
    roundWith({ viewports: CORE_SET })
    const res = await scanPost(scanRequest({ viewport: 'xl', result: {} }), params)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe(`viewport xl is not part of this round (it uses: ${CORE_LIST})`)
    expect(scanUpserts).toHaveLength(0)
  })

  it('stores a scan on a viewport of a core round', async () => {
    roundWith({ viewports: CORE_SET })
    const res = await scanPost(scanRequest({ viewport: 'laptop_m', result: {} }), params)
    expect(res.status).toBe(200)
    expect(scanUpserts).toHaveLength(1)
    expect(scanUpserts[0]).toMatchObject({ roundPageId: 'rp_1', viewport: 'laptop_m', browser: 'chromium' })
  })

  it('a legacy round keeps working on a legacy key', async () => {
    const res = await scanPost(scanRequest({ viewport: 'desktop', result: {} }), params)
    expect(res.status).toBe(200)
    expect(scanUpserts[0]).toMatchObject({ viewport: 'desktop', browser: 'chromium' })
  })

  it('a legacy round refuses a key outside the five legacy keys', async () => {
    const res = await scanPost(scanRequest({ viewport: 'laptop_m', result: {} }), params)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('viewport laptop_m is not part of this round (it uses: xl, desktop, tablet, mobile_l, mobile_p)')
    expect(scanUpserts).toHaveLength(0)
  })

  it('an unknown key is a 400 before any database work and is not echoed', async () => {
    const res = await scanPost(scanRequest({ viewport: 'x'.repeat(100), result: {} }), params)
    expect(res.status).toBe(400)
    const error = ((await res.json()) as { error: string }).error
    expect(error).toBe('viewport must be a QA viewport key')
    expect(error.length).toBeLessThan(60)
    expect(dbCalls).not.toHaveBeenCalled()
    expect(loadRoundPage).not.toHaveBeenCalled()
  })

  it('a label is not a key', async () => {
    const res = await scanPost(scanRequest({ viewport: 'Laptop M', result: {} }), params)
    expect(res.status).toBe(400)
    expect(dbCalls).not.toHaveBeenCalled()
  })

  it('a closed round is a 409 before the set check', async () => {
    roundWith({ status: 'closed', viewports: CORE_SET })
    const res = await scanPost(scanRequest({ viewport: 'xl', result: {} }), params)
    expect(res.status).toBe(409)
  })

  it('a browser outside the round is a 400 before the set check', async () => {
    roundWith({ viewports: CORE_SET })
    const res = await scanPost(scanRequest({ viewport: 'xl', browser: 'webkit', result: {} }), params)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('That browser is not part of this round')
  })
})

describe('viewport sets: comments POST', () => {
  it('refuses a viewport outside a core round after the browser check', async () => {
    roundWith({ viewports: CORE_SET })
    const res = await commentPost(commentRequest({ ...comment, viewport: 'desktop' }), params)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe(`viewport desktop is not part of this round (it uses: ${CORE_LIST})`)
    expect(commentInserts).toHaveLength(0)
  })

  it('the browser 400 comes before the set 400', async () => {
    roundWith({ viewports: CORE_SET })
    const res = await commentPost(commentRequest({ ...comment, viewport: 'desktop', browser: 'webkit' }), params)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('That browser is not part of this round')
  })

  it('stores a comment on a viewport of a core round', async () => {
    roundWith({ viewports: CORE_SET })
    const res = await commentPost(commentRequest({ ...comment, viewport: 'laptop_m' }), params)
    expect(res.status).toBe(201)
    expect(commentInserts[0]).toMatchObject({ viewport: 'laptop_m', browser: 'chromium' })
  })

  it('a legacy round keeps working on a legacy key', async () => {
    const res = await commentPost(commentRequest({ ...comment, viewport: 'mobile_p' }), params)
    expect(res.status).toBe(201)
    expect(commentInserts[0]).toMatchObject({ viewport: 'mobile_p' })
  })

  it('an unknown key is refused by the parser before any database work', async () => {
    const res = await commentPost(commentRequest({ ...comment, viewport: 'Phone M' }), params)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('viewport is not a known QA viewport')
    expect(dbCalls).not.toHaveBeenCalled()
  })

  it('a closed round is a 409 before the set check', async () => {
    roundWith({ status: 'closed', viewports: CORE_SET })
    const res = await commentPost(commentRequest({ ...comment, viewport: 'xl' }), params)
    expect(res.status).toBe(409)
  })
})
