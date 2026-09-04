/**
 * POST /api/portal/provision - the owner of a self-serve workspace.
 *
 * `contacts.portalRole` defaults to 'member', and the portal organisation,
 * brands and people routes all require an admin contact, so a founder who
 * provisioned their own workspace was refused on it until someone hand-edited
 * D1. Provisioning now stamps the primary contact as its admin.
 *
 * Also pinned here: the Tahi org can never self-provision a client workspace,
 * and an already-linked Clerk org short-circuits instead of duplicating rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: {
  selectRows: unknown[][]
  inserts: Record<string, unknown>[]
} = { selectRows: [], inserts: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_founder', orgId: 'clerk_org_1', sessionId: 'sess_1',
  }),
}))

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({
        firstName: 'Ana', lastName: 'Reid',
        emailAddresses: [{ emailAddress: 'Ana@Studio.com' }],
      }),
      getOrganizationMembershipList: vi.fn().mockResolvedValue({ data: [] }),
    },
    organizations: {
      createOrganization: vi.fn().mockResolvedValue({ id: 'clerk_org_new' }),
      getOrganization: vi.fn().mockResolvedValue({ name: 'Studio Co' }),
    },
  }),
}))

vi.mock('@/lib/events', () => ({
  dispatchDomainEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { __table: 'organisations', id: 'id', clerkOrgId: 'clerk_org_id' },
    contacts: { __table: 'contacts', id: 'id', orgId: 'org_id' },
    kanbanColumns: { __table: 'kanban_columns', id: 'id' },
  },
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => answer())
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((row: Record<string, unknown>) => {
          captured.inserts.push({ __table: tableName(table), ...row })
          return Promise.resolve(undefined)
        }),
      })),
    }),
  }
})

import { POST } from '@/app/api/portal/provision/route'
import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const contactInserts = () => captured.inserts.filter(r => r.__table === 'contacts')

describe('POST /api/portal/provision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.selectRows = []
    captured.inserts = []
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_founder', orgId: 'clerk_org_1', sessionId: 'sess_1',
    })
  })

  it('makes the primary contact the workspace admin', async () => {
    // No existing D1 org for this Clerk org, so a fresh one is created.
    captured.selectRows = [[]]

    const res = await POST(makeRequest({ name: 'Studio Co' }))
    expect(res.status).toBe(200)

    const contacts = contactInserts()
    expect(contacts).toHaveLength(1)
    expect(contacts[0].portalRole).toBe('admin')
    expect(contacts[0].isPrimary).toBe(true)
    expect(contacts[0].clerkUserId).toBe('user_founder')
    // Email is normalised so the sign-in link can match it case-insensitively.
    expect(contacts[0].email).toBe('ana@studio.com')
  })

  it('does not duplicate a workspace that is already linked', async () => {
    captured.selectRows = [[{ id: 'org_existing' }]]

    const res = await POST(makeRequest())
    const json = await res.json() as { orgId: string }
    expect(json.orgId).toBe('org_existing')
    expect(captured.inserts).toHaveLength(0)
  })

  it('refuses to provision a client workspace for the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_2',
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(captured.inserts).toHaveLength(0)
  })

  it('401s a signed-out caller', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: null, orgId: null, sessionId: null,
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })
})
