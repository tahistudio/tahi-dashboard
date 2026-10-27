/**
 * Site QA comment POST: the request size cap (413 before parsing) and the
 * stored element context.
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
  return { ...actual, loadRoundPage: vi.fn() }
})

const inserted: Record<string, unknown>[] = []
vi.mock('@/lib/db', () => ({
  db: vi.fn(async () => ({
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.from = vi.fn(() => chain)
      chain.where = vi.fn(() => chain)
      chain.limit = vi.fn(async () => [{ name: 'Liam' }])
      return chain
    }),
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        inserted.push(v)
        return { returning: vi.fn(async () => [{ ...v }]) }
      }),
    })),
  })),
}))
vi.mock('@/db/d1', () => ({
  schema: {
    qaComments: { roundPageId: 'round_page_id', createdAt: 'created_at', id: 'id' },
    teamMembers: { name: 'name', clerkUserId: 'clerk_user_id' },
  },
}))

import { POST } from '@/app/api/admin/qa/round-pages/[id]/comments/route'
import { loadRoundPage } from '@/lib/qa/server'

const params = { params: Promise.resolve({ id: 'rp_1' }) }

function post(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/admin/qa/round-pages/rp_1/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

const valid = { viewport: 'desktop', selector: 'h1', ox: 0.5, oy: 0.5, body: 'Too low' }

beforeEach(() => {
  inserted.length = 0
  vi.mocked(loadRoundPage).mockReset()
  vi.mocked(loadRoundPage).mockResolvedValue({
    roundPage: { id: 'rp_1', path: '/' },
    round: { id: 'r_1', status: 'open' },
    site: { id: 's_1' },
  } as unknown as Awaited<ReturnType<typeof loadRoundPage>>)
})

describe('POST round-pages/[id]/comments size cap', () => {
  it('refuses a declared Content-Length over 64 KB with 413 before reading', async () => {
    const res = await POST(post(JSON.stringify(valid), { 'content-length': String(64 * 1024 + 1) }), params)
    expect(res.status).toBe(413)
    expect(loadRoundPage).not.toHaveBeenCalled()
  })

  it('refuses an oversized body even when no Content-Length is declared', async () => {
    const res = await POST(post(JSON.stringify({ ...valid, body: 'x'.repeat(70 * 1024) })), params)
    expect(res.status).toBe(413)
    expect(inserted).toHaveLength(0)
  })

  it('accepts a normal body and stores the element context as JSON', async () => {
    const context = { id: null, classes: ['hero'], ancestors: [], html: '<h1></h1>', box: { x: 1, y: 2, width: 3, height: 4 }, scrollY: 0, pageHeight: 10, viewportWidth: 1440, viewportHeight: 900 }
    const res = await POST(post(JSON.stringify({ ...valid, elementContext: context })), params)
    expect(res.status).toBe(201)
    expect(typeof inserted[0].elementContext).toBe('string')
    expect(JSON.parse(inserted[0].elementContext as string).classes).toEqual(['hero'])
  })

  it('still answers 400 for invalid JSON', async () => {
    const res = await POST(post('{not json'), params)
    expect(res.status).toBe(400)
  })
})
