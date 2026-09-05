/**
 * Unit tests for the two billing facts a client now carries:
 * organisations.invoiceChannel (HOW they are billed) and
 * organisations.paymentTerms (WHEN it is due).
 *
 * Contract:
 *   GET /api/admin/clients/[id]
 *     - returns both raw columns, plus effectiveInvoiceChannel, which is the
 *       client's own channel when it has one and the studio default
 *       (settings key `invoicing.defaultChannel`, itself Stripe when unset)
 *       when it does not.
 *   PATCH /api/admin/clients/[id]
 *     - writes both when they are valid vocabulary
 *     - stores '' as NULL, because only NULL falls back to the studio default
 *     - rejects anything outside the vocabulary with a 400 and a sentence,
 *       rather than writing a value that would silently read as "unset"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  org: Row | null
  studioDefault: string | null
  updates: Row[]
} = { org: null, studioDefault: null, updates: [] }

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
    contacts: { orgId: 'contacts.orgId' },
    subscriptions: { orgId: 'subscriptions.orgId', status: 'subscriptions.status', createdAt: 'subscriptions.createdAt' },
    requests: {
      id: 'requests.id',
      title: 'requests.title',
      status: 'requests.status',
      type: 'requests.type',
      priority: 'requests.priority',
      orgId: 'requests.orgId',
      isInternal: 'requests.isInternal',
      updatedAt: 'requests.updatedAt',
      createdAt: 'requests.createdAt',
    },
    tracks: {},
    settings: { key: 'settings.key', value: 'settings.value' },
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

/**
 * A query result that is both awaitable and chainable, so one shape serves
 * `.where(...)`, `.where(...).limit(1)` and `.where(...).orderBy(...).limit(n)`.
 */
function rows(result: Row[]) {
  const node = {
    limit: () => rows(result),
    orderBy: () => rows(result),
    then: <T>(onOk: (r: Row[]) => T, onErr?: (e: unknown) => T) =>
      Promise.resolve(result).then(onOk, onErr),
  }
  return node
}

function rowsFor(table: unknown): Row[] {
  if (table === 'settings') {
    return state.studioDefault === null ? [] : [{ value: state.studioDefault }]
  }
  if (table === 'organisations') return state.org ? [state.org] : []
  return []
}

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => ({
      from: (table: unknown) => {
        const key =
          table && typeof table === 'object' && 'key' in (table as Row) ? 'settings'
            : table && typeof table === 'object' && 'id' in (table as Row) && (table as Row).id === 'organisations.id' ? 'organisations'
              : 'other'
        return { where: () => rows(rowsFor(key)) }
      },
    }),
    // billingExtras (custom_mrr and friends live outside Drizzle)
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

import { GET, PATCH } from '@/app/api/admin/clients/[id]/route'
import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'

const ctx = { params: Promise.resolve({ id: 'org-1' }) }

function getReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/clients/org-1')
}

function patchReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/clients/org-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function org(overrides: Row = {}): Row {
  return {
    id: 'org-1',
    name: 'Acme',
    status: 'active',
    invoiceChannel: null,
    paymentTerms: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  state.org = org()
  state.studioDefault = null
  state.updates = []
  vi.mocked(getRequestAuth).mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  })
})

describe('GET /api/admin/clients/[id] invoicing facts', () => {
  it('returns both columns and resolves an unset client to Stripe', async () => {
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { org: Row }
    expect(body.org.invoiceChannel).toBeNull()
    expect(body.org.paymentTerms).toBeNull()
    expect(body.org.effectiveInvoiceChannel).toBe('stripe')
  })

  it('resolves an unset client to the studio default when one is stored', async () => {
    state.studioDefault = 'xero'
    const res = await GET(getReq(), ctx)
    const body = await res.json() as { org: Row }
    expect(body.org.effectiveInvoiceChannel).toBe('xero')
  })

  it("lets the client's own channel win over the studio default", async () => {
    state.studioDefault = 'xero'
    state.org = org({ invoiceChannel: 'stripe', paymentTerms: 'net_30' })
    const res = await GET(getReq(), ctx)
    const body = await res.json() as { org: Row }
    expect(body.org.invoiceChannel).toBe('stripe')
    expect(body.org.paymentTerms).toBe('net_30')
    expect(body.org.effectiveInvoiceChannel).toBe('stripe')
  })

  it('ignores a stale studio value rather than returning it as a channel', async () => {
    state.studioDefault = 'xero_bank'
    const res = await GET(getReq(), ctx)
    const body = await res.json() as { org: Row }
    expect(body.org.effectiveInvoiceChannel).toBe('stripe')
  })
})

describe('PATCH /api/admin/clients/[id] invoicing facts', () => {
  it('writes a valid channel and terms', async () => {
    const res = await PATCH(patchReq({ invoiceChannel: 'xero', paymentTerms: 'net_30' }), ctx)
    expect(res.status).toBe(200)
    expect(state.updates[0]).toMatchObject({ invoiceChannel: 'xero', paymentTerms: 'net_30' })
  })

  it('stores null when the channel is cleared', async () => {
    const res = await PATCH(patchReq({ invoiceChannel: null }), ctx)
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('invoiceChannel', null)
  })

  it('stores the empty select as null, not as an empty string', async () => {
    const res = await PATCH(patchReq({ invoiceChannel: '', paymentTerms: '' }), ctx)
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('invoiceChannel', null)
    expect(state.updates[0]).toHaveProperty('paymentTerms', null)
  })

  it('rejects a channel outside the two rails', async () => {
    const res = await PATCH(patchReq({ invoiceChannel: 'xero_bank' }), ctx)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('invoiceChannel')
    expect(body.error).toContain('xero')
    expect(state.updates).toHaveLength(0)
  })

  it('rejects terms outside the vocabulary', async () => {
    const res = await PATCH(patchReq({ paymentTerms: 'net_45' }), ctx)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('paymentTerms')
    expect(state.updates).toHaveLength(0)
  })

  it('stays forbidden for a non-admin org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: 'user_client',
      orgId: 'org_other',
      sessionId: 'sess_2',
    })
    const res = await PATCH(patchReq({ invoiceChannel: 'xero' }), ctx)
    expect(res.status).toBe(403)
    expect(state.updates).toHaveLength(0)
  })
})
