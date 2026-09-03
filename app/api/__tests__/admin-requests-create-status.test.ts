/**
 * POST /api/admin/requests: the creatable-status whitelist.
 *
 * The kanban's quick-add drops a card into whichever column it was typed
 * in, so the create route accepts a starting status. Delivered and
 * cancelled are the two ends of a request's life and carry side effects
 * (delivery timestamps, notifications) that belong to the status PATCH, so
 * nothing may be born there.
 *
 * These tests are the authority for that list. request-list.tsx mirrors it
 * as CREATABLE_STATUSES to decide which columns offer a quick-add at all,
 * and workers/mcp-server names the same set in create_request's schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted and cannot reference outer variables.
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
    run: vi.fn().mockResolvedValue({ meta: { last_row_id: 1 } }),
  }),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: { id: 'id', orgId: 'org_id', title: 'title', status: 'status', assigneeId: 'assignee_id' },
    organisations: { id: 'id', name: 'name' },
  },
}))

import { POST } from '@/app/api/admin/requests/route'
import { NextRequest } from 'next/server'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BASE = { clientOrgId: 'org_client_1', title: 'Quick add from the board' }

describe('POST /api/admin/requests, starting status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to submitted when no status is given', async () => {
    const res = await POST(makeRequest(BASE))
    expect(res.status).toBe(201)
  })

  for (const status of ['submitted', 'in_review', 'in_progress', 'client_review', 'on_hold', 'archived']) {
    it(`accepts ${status}`, async () => {
      const res = await POST(makeRequest({ ...BASE, status }))
      expect(res.status).toBe(201)
    })
  }

  for (const status of ['delivered', 'cancelled']) {
    it(`rejects ${status}, which has to be moved to rather than created at`, async () => {
      const res = await POST(makeRequest({ ...BASE, status }))
      expect(res.status).toBe(400)
      const json = await res.json() as { error?: string }
      expect(json.error).toContain('status must be one of')
      expect(json.error).not.toContain(status)
    })
  }

  it('rejects a status outside the request vocabulary', async () => {
    const res = await POST(makeRequest({ ...BASE, status: 'todo' }))
    expect(res.status).toBe(400)
  })

  it('rejects a status before it reaches the database', async () => {
    const { db } = await import('@/lib/db')
    await POST(makeRequest({ ...BASE, status: 'delivered' }))
    expect(vi.mocked(db)).not.toHaveBeenCalled()
  })
})
