/**
 * POST /api/admin/deals/[id]/convert-to-client and the plan the new client
 * starts on.
 *
 * The route used to read a retainer deal as a Maintain plan and mint an
 * active subscription for it, so a won Scale retainer, or a retainer still
 * being negotiated, landed as a Maintain client nothing was ever billed
 * against. A deal has no plan column, so there is nothing to infer from.
 * Contract now:
 *   - no body, or no planType in it, creates the client with no plan and no
 *     subscription, whatever the deal's engagementType says
 *   - an explicit maintain or scale provisions the subscription and its
 *     tracks, the same shape POST /api/admin/clients uses
 *   - an explicit one-off plan is a label only
 *   - a slug outside the vocabulary is refused before anything is written
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: { deal: Row | null; inserts: Row[]; updates: Row[] } = { deal: null, inserts: [], updates: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/events', () => ({
  dispatchDomainEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/api/admin/deals/_access', () => ({
  denyIfDealOrgOutOfScope: vi.fn().mockResolvedValue(null),
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    deals: {
      __table: 'deals',
      id: 'deals.id',
      title: 'deals.title',
      orgId: 'deals.orgId',
      engagementType: 'deals.engagementType',
      stageId: 'deals.stageId',
    },
    pipelineStages: { __table: 'pipeline_stages', id: 'stages.id', isClosedWon: 'stages.isClosedWon' },
    organisations: { __table: 'organisations', id: 'organisations.id', name: 'organisations.name', status: 'organisations.status' },
    dealContacts: { __table: 'deal_contacts', dealId: 'deal_contacts.dealId', contactId: 'deal_contacts.contactId' },
    contacts: { __table: 'contacts', id: 'contacts.id', orgId: 'contacts.orgId' },
    kanbanColumns: { __table: 'kanban_columns' },
    subscriptions: { __table: 'subscriptions' },
    tracks: { __table: 'tracks' },
  },
}))

const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'

function chain(result: Row[]) {
  const node: Record<string, unknown> = {
    leftJoin: () => chain(result),
    where: () => chain(result),
    limit: () => chain(result),
    then: <T>(onOk: (r: Row[]) => T, onErr?: (e: unknown) => T) =>
      Promise.resolve(result).then(onOk, onErr),
  }
  return node
}

function rowsFor(table: string): Row[] {
  if (table === 'deals') return state.deal ? [state.deal] : []
  return []
}

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => ({
      from: (table: unknown) => chain(rowsFor(tableName(table))),
    }),
    insert: (table: unknown) => ({
      values: (rowOrRows: Row | Row[]) => {
        const list = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
        for (const row of list) state.inserts.push({ __table: tableName(table), ...row })
        return Promise.resolve(undefined)
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Row) => {
        state.updates.push({ __table: tableName(table), ...patch })
        return { where: () => Promise.resolve(undefined) }
      },
    }),
  }),
}))

import { POST } from '@/app/api/admin/deals/[id]/convert-to-client/route'
import { NextRequest } from 'next/server'

const ctx = { params: Promise.resolve({ id: 'deal-1' }) }

function req(body?: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/deals/deal-1/convert-to-client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const rows = (table: string) => state.inserts.filter(r => r.__table === table)

beforeEach(() => {
  state.deal = {
    id: 'deal-1',
    title: 'Retainer for Acme',
    orgId: null,
    engagementType: 'retainer',
    stageIsClosedWon: true,
  }
  state.inserts = []
  state.updates = []
})

describe('POST /api/admin/deals/[id]/convert-to-client plan', () => {
  it('creates the client with no plan and no subscription when the body names none, even for a retainer deal', async () => {
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { created: boolean; orgId: string }
    expect(body.created).toBe(true)
    expect(rows('organisations')).toHaveLength(1)
    expect(rows('organisations')[0].planType).toBe('none')
    expect(rows('subscriptions')).toHaveLength(0)
    expect(rows('tracks')).toHaveLength(0)
  })

  it('treats an explicit null as no plan', async () => {
    const res = await POST(req({ planType: null }), ctx)
    expect(res.status).toBe(200)
    expect(rows('organisations')[0].planType).toBe('none')
    expect(rows('subscriptions')).toHaveLength(0)
  })

  it('provisions a Maintain subscription and one small track when asked', async () => {
    const res = await POST(req({ planType: 'maintain' }), ctx)
    expect(res.status).toBe(200)
    expect(rows('organisations')[0].planType).toBe('maintain')
    expect(rows('subscriptions')).toHaveLength(1)
    expect(rows('subscriptions')[0]).toMatchObject({ planType: 'maintain', status: 'active' })
    expect(rows('tracks').map(t => t.type)).toEqual(['small'])
  })

  it('provisions a Scale subscription with a small and a large track when asked', async () => {
    const res = await POST(req({ planType: 'scale' }), ctx)
    expect(res.status).toBe(200)
    expect(rows('subscriptions')[0]).toMatchObject({ planType: 'scale' })
    expect(rows('tracks').map(t => t.type).sort()).toEqual(['large', 'small'])
  })

  it('stores a one-off plan as a label with no subscription', async () => {
    const res = await POST(req({ planType: 'launch' }), ctx)
    expect(res.status).toBe(200)
    expect(rows('organisations')[0].planType).toBe('launch')
    expect(rows('subscriptions')).toHaveLength(0)
  })

  it('refuses a plan outside the vocabulary before writing anything', async () => {
    const res = await POST(req({ planType: 'gold' }), ctx)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('planType')
    expect(state.inserts).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
  })
})
