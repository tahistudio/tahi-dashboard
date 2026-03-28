/**
 * Unit tests for POST /api/admin/clients validation logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks - vi.mock factories cannot reference outer variables (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { id: 'id', name: 'name', status: 'status', planType: 'plan_type', website: 'website', createdAt: 'created_at' },
    contacts: {},
    subscriptions: {},
    tracks: {},
    kanbanColumns: {},
  },
}))

import { POST } from '@/app/api/admin/clients/route'
import { NextRequest } from 'next/server'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/admin/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when name is missing', async () => {
    const req = makeRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, string>
    expect(json.error).toContain('name')
  })

  it('returns 400 when name is empty string', async () => {
    const req = makeRequest({ name: '   ' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 201 with valid name', async () => {
    const req = makeRequest({ name: 'Acme Corp' })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json() as Record<string, unknown>
    expect(json.id).toBeTruthy()
  })

  it('returns 403 for non-admin users', async () => {
    const { getRequestAuth } = await import('@/lib/server-auth')
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: 'user_client',
      orgId: 'org_other',
      sessionId: 'sess_2',
    })
    const req = makeRequest({ name: 'Test Corp' })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
