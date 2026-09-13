/**
 * POST /api/admin/clients and the studio default project manager.
 *
 * "project manager for all clients, and is the default for all new ones...
 * by type of project/retainer." A retainer plan type (maintain, scale) reads
 * studio.defaultProjectManagerId.retainer; anything else (a one-off plan, or
 * no plan at all, both a deliberate choice at creation time) reads
 * studio.defaultProjectManagerId.project. See
 * lib/default-project-manager-server.ts for the writer this route calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: { inserts: Record<string, unknown>[] } = { inserts: [] }
const selectRows: Record<string, Record<string, unknown>[]> = {}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/events', () => ({
  dispatchDomainEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, or: stub, ne: stub, like: stub, desc: stub, inArray: stub, sql: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { __table: 'organisations', id: 'id' },
    contacts: { __table: 'contacts', id: 'id' },
    subscriptions: { __table: 'subscriptions', id: 'id' },
    tracks: { __table: 'tracks', id: 'id' },
    kanbanColumns: { __table: 'kanban_columns', id: 'id' },
    onboardingInvites: { __table: 'onboarding_invites', id: 'id' },
    settings: { __table: 'settings', key: 'key', value: 'value' },
    teamMembers: { __table: 'team_members', id: 'id' },
    teamMemberAccess: { __table: 'team_member_access', id: 'id', role: 'role' },
    teamMemberAccessOrgs: { __table: 'team_member_access_orgs', accessId: 'access_id', orgId: 'org_id' },
  },
}))

function chain(rows: Record<string, unknown>[]) {
  const node = {
    where: () => chain(rows),
    limit: () => chain(rows),
    then: <T,>(onOk: (r: Record<string, unknown>[]) => T, onErr?: (e: unknown) => T) =>
      Promise.resolve(rows).then(onOk, onErr),
  }
  return node
}

vi.mock('@/lib/db', () => {
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    db: vi.fn().mockResolvedValue({
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((row: Record<string, unknown>) => {
          captured.inserts.push({ __table: tableName(table), ...row })
          return Promise.resolve(undefined)
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => chain(selectRows[tableName(table)] ?? [])),
      })),
    }),
  }
})

import { POST } from '@/app/api/admin/clients/route'
import { NextRequest } from 'next/server'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const rows = (table: string) => captured.inserts.filter(r => r.__table === table)

beforeEach(() => {
  vi.clearAllMocks()
  captured.inserts = []
  for (const key of Object.keys(selectRows)) delete selectRows[key]
})

describe('POST /api/admin/clients default project manager', () => {
  it('a retainer plan (maintain) is assigned from studio.defaultProjectManagerId.retainer', async () => {
    selectRows.settings = [{ value: 'tm_liam' }]
    selectRows.team_members = [{ id: 'tm_liam' }]

    const res = await POST(makeRequest({ name: 'Maintain Client', planType: 'maintain' }))
    expect(res.status).toBe(201)

    const orgId = rows('organisations')[0].id as string
    expect(rows('team_member_access')).toHaveLength(1)
    expect(rows('team_member_access')[0]).toMatchObject({
      teamMemberId: 'tm_liam',
      role: 'project_manager',
      scopeType: 'specific_clients',
      trackType: 'all',
    })
    expect(rows('team_member_access_orgs')).toHaveLength(1)
    expect(rows('team_member_access_orgs')[0]).toMatchObject({ orgId })
    expect(rows('team_member_access_orgs')[0].accessId).toBe(rows('team_member_access')[0].id)
  })

  it('a one-off plan (launch) is assigned from studio.defaultProjectManagerId.project instead', async () => {
    selectRows.settings = [{ value: 'tm_staci' }]
    selectRows.team_members = [{ id: 'tm_staci' }]

    const res = await POST(makeRequest({ name: 'Launch Client', planType: 'launch' }))
    expect(res.status).toBe(201)
    expect(rows('team_member_access')).toHaveLength(1)
    expect(rows('team_member_access')[0]).toMatchObject({ teamMemberId: 'tm_staci', role: 'project_manager' })
  })

  it('no plan at all also reads the project default, not the retainer one', async () => {
    selectRows.settings = [{ value: 'tm_staci' }]
    selectRows.team_members = [{ id: 'tm_staci' }]

    const res = await POST(makeRequest({ name: 'No Plan Client' }))
    expect(res.status).toBe(201)
    expect(rows('team_member_access')).toHaveLength(1)
    expect(rows('team_member_access')[0]).toMatchObject({ teamMemberId: 'tm_staci' })
  })

  it('no default configured: creates the client with no project manager rule at all', async () => {
    const res = await POST(makeRequest({ name: 'No Default Client', planType: 'maintain' }))
    expect(res.status).toBe(201)
    expect(rows('team_member_access')).toHaveLength(0)
    expect(rows('team_member_access_orgs')).toHaveLength(0)
  })
})
