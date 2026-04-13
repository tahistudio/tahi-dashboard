/**
 * Unit tests for POST /api/uploads/confirm validation logic.
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
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'member_1' }]),
        }),
      }),
    }),
  }),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    files: {},
    teamMembers: { id: 'id', clerkUserId: 'clerk_user_id' },
    contacts: { id: 'id', clerkUserId: 'clerk_user_id' },
  },
}))

// Mock drizzle-orm eq function
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}))

import { POST } from '@/app/api/uploads/confirm/route'
import { NextRequest } from 'next/server'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/uploads/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Set env for admin check
process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/uploads/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when storageKey is missing', async () => {
    const req = makeRequest({ filename: 'test.png' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.error).toBeTruthy()
  })

  it('returns 400 when filename is missing', async () => {
    const req = makeRequest({ storageKey: 'uploads/abc.png' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when both storageKey and filename are missing', async () => {
    const req = makeRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 201 with valid storageKey and filename', async () => {
    const req = makeRequest({
      storageKey: 'uploads/abc.png',
      filename: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 12345,
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json() as Record<string, unknown>
    expect(json.id).toBeTruthy()
  })

  it('returns 401 for unauthenticated users', async () => {
    const { getRequestAuth } = await import('@/lib/server-auth')
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: null,
      orgId: null,
      sessionId: null,
    })
    const req = makeRequest({
      storageKey: 'uploads/abc.png',
      filename: 'test.png',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
