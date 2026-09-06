/**
 * POST /api/admin/clients and the plan a new client starts on.
 *
 * A new organisation has no plan until a subscription exists for it, unless
 * the caller names one. Contract:
 *   - omitted, null and '' all store the column's own 'none'
 *   - a one-off plan (launch, tune, hourly, custom) is a label: stored, no
 *     subscription row
 *   - maintain and scale are the two that create the subscription and its
 *     tracks (one small; one small and one large)
 *   - a slug outside the vocabulary is refused before anything is written
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: { inserts: Record<string, unknown>[] } = { inserts: [] }

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
    requests: { __table: 'requests', orgId: 'org_id', status: 'status' },
  },
}))

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
})

describe('POST /api/admin/clients plan default', () => {
  it('creates a client with no plan when none is named, and no subscription', async () => {
    const res = await POST(makeRequest({ name: 'Fresh Prospect' }))
    expect(res.status).toBe(201)
    expect(rows('organisations')).toHaveLength(1)
    expect(rows('organisations')[0].planType).toBe('none')
    expect(rows('subscriptions')).toHaveLength(0)
    expect(rows('tracks')).toHaveLength(0)
  })

  it.each([null, ''])('treats planType %j as no plan', async (value) => {
    const res = await POST(makeRequest({ name: 'Fresh Prospect', planType: value }))
    expect(res.status).toBe(201)
    expect(rows('organisations')[0].planType).toBe('none')
    expect(rows('subscriptions')).toHaveLength(0)
  })

  it('stores an explicit one-off plan as a label with no subscription', async () => {
    const res = await POST(makeRequest({ name: 'Launch Client', planType: 'launch' }))
    expect(res.status).toBe(201)
    expect(rows('organisations')[0].planType).toBe('launch')
    expect(rows('subscriptions')).toHaveLength(0)
    expect(rows('tracks')).toHaveLength(0)
  })

  it('provisions a subscription and one small track for an explicit Maintain', async () => {
    const res = await POST(makeRequest({ name: 'Maintain Client', planType: 'maintain' }))
    expect(res.status).toBe(201)
    expect(rows('organisations')[0].planType).toBe('maintain')
    expect(rows('subscriptions')).toHaveLength(1)
    expect(rows('subscriptions')[0]).toMatchObject({ planType: 'maintain', status: 'active' })
    expect(rows('tracks').map(t => t.type)).toEqual(['small'])
  })

  it('provisions a subscription and a small plus a large track for an explicit Scale', async () => {
    const res = await POST(makeRequest({ name: 'Scale Client', planType: 'scale' }))
    expect(res.status).toBe(201)
    expect(rows('subscriptions')).toHaveLength(1)
    expect(rows('tracks').map(t => t.type).sort()).toEqual(['large', 'small'])
  })

  it('refuses a plan outside the vocabulary before writing anything', async () => {
    const res = await POST(makeRequest({ name: 'Typo Client', planType: 'gold' }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('planType')
    expect(captured.inserts).toHaveLength(0)
  })
})
