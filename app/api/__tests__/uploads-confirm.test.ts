/**
 * Unit tests for POST /api/uploads/confirm validation + org-identity logic.
 *
 * The canonical file identity is the D1 organisations.id: clients can never
 * choose the owning org (body.orgId is ignored and forced to their resolved
 * D1 org), admins may target a validated org explicitly. The storage key
 * prefix must belong to the caller so nobody can register a files row
 * pointing at another tenant's R2 key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks - vi.mock factories are hoisted, shared state goes through vi.hoisted
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  state: {
    // Queue of result sets for organisations selects (resolveD1OrgId /
    // resolveTargetOrgId issue up to two in order: primary match, fallback).
    orgResults: [] as Array<Array<{ id: string }>>,
    requestRows: [] as Array<{ orgId: string }>,
    fileRows: [] as Array<{ id: string; orgId: string }>,
    memberRows: [] as Array<{ id: string }>,
    contactRows: [] as Array<{ id: string }>,
    inserted: [] as Array<Record<string, unknown>>,
    updated: [] as Array<Record<string, unknown>>,
  },
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    files: { __t: 'files' },
    requests: { __t: 'requests' },
    teamMembers: { __t: 'teamMembers', id: 'id', clerkUserId: 'clerk_user_id' },
    contacts: { __t: 'contacts', id: 'id', clerkUserId: 'clerk_user_id' },
    organisations: { __t: 'organisations', id: 'id', clerkOrgId: 'clerk_org_id' },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockImplementation(async () => ({
    select: () => ({
      from: (table: { __t?: string }) => ({
        where: () => ({
          limit: async () => {
            switch (table?.__t) {
              case 'organisations': return h.state.orgResults.shift() ?? []
              case 'requests': return h.state.requestRows
              case 'files': return h.state.fileRows
              case 'teamMembers': return h.state.memberRows
              case 'contacts': return h.state.contactRows
              default: return []
            }
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => { h.state.inserted.push(v) },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => { h.state.updated.push(v) },
      }),
    }),
  })),
}))

import { POST } from '@/app/api/uploads/confirm/route'
import { getRequestAuth } from '@/lib/server-auth'
import { requireAccessToOrg } from '@/lib/require-access'
import { NextRequest } from 'next/server'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/uploads/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function asClient() {
  vi.mocked(getRequestAuth).mockResolvedValue({
    userId: 'user_client',
    orgId: 'org_client_clerk',
    sessionId: 'sess_2',
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/uploads/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_admin',
      orgId: 'org_tahi',
      sessionId: 'sess_1',
    })
    vi.mocked(requireAccessToOrg).mockResolvedValue(null)
    h.state.orgResults = []
    h.state.requestRows = []
    h.state.fileRows = []
    h.state.memberRows = [{ id: 'member_1' }]
    h.state.contactRows = [{ id: 'contact_1' }]
    h.state.inserted = []
    h.state.updated = []
  })

  it('returns 400 when storageKey is missing', async () => {
    const res = await POST(makeRequest({ filename: 'test.png' }))
    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.error).toBeTruthy()
  })

  it('returns 400 when filename is missing', async () => {
    const res = await POST(makeRequest({ storageKey: 'org_tahi/general/1-abc.png' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when both storageKey and filename are missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 401 for unauthenticated users', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: null,
      orgId: null,
      sessionId: null,
    })
    const res = await POST(makeRequest({
      storageKey: 'org_tahi/general/1-abc.png',
      filename: 'test.png',
    }))
    expect(res.status).toBe(401)
  })

  it('returns 201 for an admin upload under the Tahi prefix', async () => {
    const res = await POST(makeRequest({
      storageKey: 'org_tahi/general/1-abc.png',
      filename: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 12345,
    }))
    expect(res.status).toBe(201)
    const json = await res.json() as Record<string, unknown>
    expect(json.id).toBeTruthy()
    expect(h.state.inserted).toHaveLength(1)
    expect(h.state.inserted[0].orgId).toBe('org_tahi')
    expect(h.state.inserted[0].uploadedById).toBe('member_1')
    expect(h.state.inserted[0].uploadedByType).toBe('team_member')
  })

  it('ignores a spoofed body.orgId from a non-admin and forces their own D1 org', async () => {
    asClient()
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    const res = await POST(makeRequest({
      storageKey: 'org_client_d1/general/1-a.png',
      filename: 'a.png',
      orgId: 'org_victim_d1',
    }))
    expect(res.status).toBe(201)
    expect(h.state.inserted).toHaveLength(1)
    expect(h.state.inserted[0].orgId).toBe('org_client_d1')
    expect(h.state.inserted[0].uploadedById).toBe('contact_1')
    expect(h.state.inserted[0].uploadedByType).toBe('contact')
  })

  it('normalises a legacy Clerk-prefixed key onto the D1 org id for clients', async () => {
    asClient()
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    const res = await POST(makeRequest({
      storageKey: 'org_client_clerk/general/1-a.png',
      filename: 'a.png',
    }))
    expect(res.status).toBe(201)
    expect(h.state.inserted[0].orgId).toBe('org_client_d1')
  })

  it('returns 403 for a client with no provisioned D1 org', async () => {
    asClient()
    h.state.orgResults = [[], []]
    const res = await POST(makeRequest({
      storageKey: 'org_client_clerk/general/1-a.png',
      filename: 'a.png',
    }))
    expect(res.status).toBe(403)
    expect(h.state.inserted).toHaveLength(0)
  })

  it('rejects a non-admin confirming a key under another org prefix', async () => {
    asClient()
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    const res = await POST(makeRequest({
      storageKey: 'org_victim_d1/general/1-a.png',
      filename: 'a.png',
    }))
    expect(res.status).toBe(403)
    expect(h.state.inserted).toHaveLength(0)
  })

  it('rejects a non-admin attaching to a request in another org', async () => {
    asClient()
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    h.state.requestRows = [{ orgId: 'org_other_d1' }]
    const res = await POST(makeRequest({
      storageKey: 'org_client_d1/req_1/1-a.png',
      filename: 'a.png',
      requestId: 'req_1',
    }))
    expect(res.status).toBe(403)
    expect(h.state.inserted).toHaveLength(0)
  })

  it('honours an admin body.orgId override after validating the org', async () => {
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    const res = await POST(makeRequest({
      storageKey: 'org_client_d1/general/1-a.png',
      filename: 'a.png',
      orgId: 'org_client_d1',
    }))
    expect(res.status).toBe(201)
    expect(h.state.inserted[0].orgId).toBe('org_client_d1')
    expect(vi.mocked(requireAccessToOrg)).toHaveBeenCalled()
  })

  it('returns 400 for an admin override naming an unknown org', async () => {
    h.state.orgResults = [[], []]
    const res = await POST(makeRequest({
      storageKey: 'org_client_d1/general/1-a.png',
      filename: 'a.png',
      orgId: 'org_nope',
    }))
    expect(res.status).toBe(400)
    expect(h.state.inserted).toHaveLength(0)
  })

  it('derives the owning org from a real requestId for admins', async () => {
    h.state.requestRows = [{ orgId: 'org_client_d1' }]
    const res = await POST(makeRequest({
      storageKey: 'org_client_d1/req_9/1-a.png',
      filename: 'a.png',
      requestId: 'req_9',
    }))
    expect(res.status).toBe(201)
    expect(h.state.inserted[0].orgId).toBe('org_client_d1')
  })

  it('re-confirm is idempotent and normalises a legacy Clerk-id row', async () => {
    asClient()
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    h.state.fileRows = [{ id: 'file_1', orgId: 'org_client_clerk' }]
    const res = await POST(makeRequest({
      fileId: 'file_1',
      storageKey: 'org_client_d1/general/1-a.png',
      filename: 'a.png',
    }))
    expect(res.status).toBe(200)
    expect(h.state.inserted).toHaveLength(0)
    expect(h.state.updated).toHaveLength(1)
    expect(h.state.updated[0].orgId).toBe('org_client_d1')
  })

  it('rejects a non-admin re-confirm of a row owned by another org', async () => {
    asClient()
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    h.state.fileRows = [{ id: 'file_2', orgId: 'org_victim_d1' }]
    const res = await POST(makeRequest({
      fileId: 'file_2',
      storageKey: 'org_client_d1/general/1-a.png',
      filename: 'a.png',
    }))
    expect(res.status).toBe(403)
    expect(h.state.updated).toHaveLength(0)
    expect(h.state.inserted).toHaveLength(0)
  })
})
