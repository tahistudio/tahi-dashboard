/**
 * PATCH /api/admin/clients/[id] and the plan a client carries.
 *
 * The founder could not clear a plan a prospect never bought: the route took
 * planType but had no notion of "no plan", and the settings tab never offered
 * one. Contract now:
 *   - null, '' and 'none' all clear the plan and are stored as the column's
 *     own 'none', so the list filter and the plan_type access scope keep
 *     matching with `=` (a NULL row and a 'none' row must not be two clients)
 *   - a real plan is stored as itself
 *   - a slug outside the vocabulary is refused with a 400 and a sentence
 *   - the org verdict still comes before the payload verdict
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: { updates: Row[] } = { updates: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/billing-derivation', () => ({
  applyBillingDerivation: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { id: 'organisations.id' },
    contacts: {},
    subscriptions: {},
    requests: {},
    tracks: {},
    settings: {},
  },
}))

vi.mock('drizzle-orm', () => {
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __sql: strings.join('?'), values }),
    { raw: (text: string) => ({ __raw: text }) },
  )
  return {
    sql,
    eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
    and: (...parts: unknown[]) => ({ __op: 'and', parts }),
    desc: (col: unknown) => ({ __op: 'desc', col }),
  }
})

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    all: () => Promise.resolve([]),
    run: () => Promise.resolve(undefined),
    update: () => ({
      set: (patch: Row) => {
        state.updates.push(patch)
        return { where: () => Promise.resolve(undefined) }
      },
    }),
  }),
}))

import { PATCH } from '@/app/api/admin/clients/[id]/route'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { requireAccessToOrg } from '@/lib/require-access'

const ctx = { params: Promise.resolve({ id: 'org-1' }) }

function patchReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/clients/org-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.updates = []
  vi.mocked(getRequestAuth).mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  })
  vi.mocked(requireAccessToOrg).mockResolvedValue(null)
})

describe('PATCH /api/admin/clients/[id] planType', () => {
  it('clears the plan when null is sent, storing the column default', async () => {
    const res = await PATCH(patchReq({ planType: null }), ctx)
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('planType', 'none')
  })

  it.each(['', 'none'])('stores %j as the same no-plan spelling', async (value) => {
    const res = await PATCH(patchReq({ planType: value }), ctx)
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('planType', 'none')
  })

  it('stores a real plan as itself', async () => {
    const res = await PATCH(patchReq({ planType: 'launch' }), ctx)
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('planType', 'launch')
  })

  it('leaves the plan alone when the body does not mention it', async () => {
    const res = await PATCH(patchReq({ name: 'Renamed' }), ctx)
    expect(res.status).toBe(200)
    expect(state.updates[0]).not.toHaveProperty('planType')
    expect(state.updates[0]).toHaveProperty('name', 'Renamed')
  })

  it('refuses a slug outside the vocabulary with a sentence and writes nothing', async () => {
    const res = await PATCH(patchReq({ planType: 'gold' }), ctx)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('planType')
    expect(body.error).toContain('maintain')
    expect(state.updates).toHaveLength(0)
  })

  it('answers 403, not 400, when the caller cannot reach this org', async () => {
    vi.mocked(requireAccessToOrg).mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )
    const res = await PATCH(patchReq({ planType: 'gold' }), ctx)
    expect(res.status).toBe(403)
    expect(state.updates).toHaveLength(0)
  })

  it('stays forbidden for a non-admin org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: 'user_client',
      orgId: 'org_other',
      sessionId: 'sess_2',
    })
    const res = await PATCH(patchReq({ planType: null }), ctx)
    expect(res.status).toBe(403)
    expect(state.updates).toHaveLength(0)
  })
})
