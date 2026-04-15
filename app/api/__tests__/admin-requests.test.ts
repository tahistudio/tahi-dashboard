/**
 * Unit tests for POST /api/admin/requests validation logic.
 *
 * These tests verify the request validation without hitting a real database.
 * We mock the auth and db modules, then call the route handler directly.
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
    run: vi.fn().mockResolvedValue({ meta: { last_row_id: 1 } }),  // atomic request numbering uses drizzle.run(sql`...`)
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
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
  }),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: { id: 'id', orgId: 'org_id', title: 'title', status: 'status', assigneeId: 'assignee_id' },
    organisations: { id: 'id', name: 'name' },
  },
}))

// Import after mocks are set up
import { POST } from '@/app/api/admin/requests/route'
import { NextRequest } from 'next/server'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/admin/requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when title is missing', async () => {
    const req = makeRequest({ clientOrgId: 'org_client_1' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.error).toBeTruthy()
  })

  it('returns 400 when clientOrgId is missing', async () => {
    const req = makeRequest({ title: 'Build homepage' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.error).toBeTruthy()
  })

  it('returns 400 when both title and clientOrgId are missing', async () => {
    const req = makeRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when title is empty string', async () => {
    const req = makeRequest({ clientOrgId: 'org_1', title: '   ' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 201 with valid body', async () => {
    const req = makeRequest({ clientOrgId: 'org_client_1', title: 'Build homepage' })
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
    const req = makeRequest({ clientOrgId: 'org_1', title: 'Test' })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
