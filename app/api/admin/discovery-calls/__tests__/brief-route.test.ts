/**
 * GET /api/admin/discovery-calls/[id]/brief: the gates in front of the LP.4
 * client call brief. The assembly itself is covered by lib/client-call-brief.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse, NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn() }))
vi.mock('@/lib/discovery-call-access', () => ({ requireDiscoveryCallAccess: vi.fn() }))
vi.mock('@/lib/client-call-brief-data', () => ({
  resolveBriefSections: vi.fn(),
  loadClientCallBrief: vi.fn(),
}))

import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireDiscoveryCallAccess } from '@/lib/discovery-call-access'
import { loadClientCallBrief, resolveBriefSections } from '@/lib/client-call-brief-data'
import { GET } from '@/app/api/admin/discovery-calls/[id]/brief/route'

const ctx = { params: Promise.resolve({ id: 'call_1' }) }
const makeReq = () => new NextRequest('http://localhost/api/admin/discovery-calls/call_1/brief')
type Auth = Awaited<ReturnType<typeof getRequestAuth>>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u1', orgId: 'org_tahi' } as Auth)
  vi.mocked(requireFeature).mockResolvedValue(null)
  vi.mocked(requireDiscoveryCallAccess).mockResolvedValue(null)
  vi.mocked(resolveBriefSections).mockResolvedValue({ requests: true, tasks: true, finance: false })
})

describe('GET brief', () => {
  it('refuses a non-admin before touching anything', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u2', orgId: 'org_client' } as Auth)
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(403)
    expect(loadClientCallBrief).not.toHaveBeenCalled()
  })

  it('refuses a seat without the calls feature', async () => {
    vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(403)
    expect(loadClientCallBrief).not.toHaveBeenCalled()
  })

  it('refuses a call outside the caller scope and never loads the brief', async () => {
    vi.mocked(requireDiscoveryCallAccess).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(403)
    expect(loadClientCallBrief).not.toHaveBeenCalled()
  })

  it('returns 404 when the call is missing', async () => {
    vi.mocked(loadClientCallBrief).mockResolvedValue({ status: 'not_found' })
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(404)
  })

  it('returns the brief and passes the resolved sections through', async () => {
    vi.mocked(loadClientCallBrief).mockResolvedValue({ status: 'ok', brief: { callId: 'call_1' } as never })
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(200)
    expect((await res.json() as { brief: { callId: string } }).brief.callId).toBe('call_1')
    expect(vi.mocked(loadClientCallBrief).mock.calls[0][2]).toEqual({ requests: true, tasks: true, finance: false })
  })
})
