/**
 * The studio-wide invoicing default, GET and PATCH on /api/admin/settings.
 *
 * Contract:
 *   GET  fills `invoicing.defaultChannel` in with Stripe whenever no row holds
 *        one of the two rails, so no reader has to know that an absent row
 *        means Stripe.
 *   PATCH rejects a value outside the vocabulary, because storing one would
 *        silently resolve every unset client back to Stripe with no sign of
 *        it, but ACCEPTS null and the empty string: that is the clear, and
 *        clearing is safe precisely because GET synthesises the default.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  rows: Row[]
  updates: Row[]
  inserts: Row[]
} = { rows: [], updates: [], inserts: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/db/d1', () => ({
  schema: { settings: { key: 'settings.key', value: 'settings.value' } },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
}))

function chain(result: Row[]) {
  const node = {
    where: () => chain(result),
    limit: () => chain(result),
    then: <T>(onOk: (r: Row[]) => T, onErr?: (e: unknown) => T) =>
      Promise.resolve(result).then(onOk, onErr),
  }
  return node
}

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => ({ from: () => chain(state.rows) }),
    update: () => ({
      set: (patch: Row) => {
        state.updates.push(patch)
        return { where: () => Promise.resolve(undefined) }
      },
    }),
    insert: () => ({
      values: (row: Row) => {
        state.inserts.push(row)
        return Promise.resolve(undefined)
      },
    }),
  }),
}))

import { GET, PATCH } from '@/app/api/admin/settings/route'
import { NextRequest } from 'next/server'
import { INVOICE_CHANNEL_SETTING_KEY, isInvoiceChannel } from '@/lib/invoice-channel'
import {
  BANK_DETAILS_SETTING_KEY,
  DEFAULT_XERO_EMAIL_MODE,
  XERO_EMAIL_MODE_SETTING_KEY,
  XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY,
} from '@/lib/invoice-pay-settings'

function getReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/settings')
}

function patchReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.rows = []
  state.updates = []
  state.inserts = []
})

describe('GET /api/admin/settings default invoicing channel', () => {
  it('synthesises Stripe when no row holds a channel', async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json() as { settings: Record<string, string | null> }
    expect(body.settings[INVOICE_CHANNEL_SETTING_KEY]).toBe('stripe')
  })

  it('returns the stored channel when there is one', async () => {
    state.rows = [{ key: INVOICE_CHANNEL_SETTING_KEY, value: 'xero' }]
    const res = await GET(getReq())
    const body = await res.json() as { settings: Record<string, string | null> }
    expect(body.settings[INVOICE_CHANNEL_SETTING_KEY]).toBe('xero')
  })

  it('reads a cleared row as Stripe rather than as an empty channel', async () => {
    state.rows = [{ key: INVOICE_CHANNEL_SETTING_KEY, value: null }]
    const res = await GET(getReq())
    const body = await res.json() as { settings: Record<string, string | null> }
    expect(body.settings[INVOICE_CHANNEL_SETTING_KEY]).toBe('stripe')
  })
})

describe('PATCH /api/admin/settings default invoicing channel', () => {
  it('stores a value from the vocabulary', async () => {
    const res = await PATCH(patchReq({ key: INVOICE_CHANNEL_SETTING_KEY, value: 'xero' }))
    expect(res.status).toBe(200)
    expect(state.inserts[0]).toMatchObject({ key: INVOICE_CHANNEL_SETTING_KEY, value: 'xero' })
  })

  it('rejects a value outside the two rails', async () => {
    const res = await PATCH(patchReq({ key: INVOICE_CHANNEL_SETTING_KEY, value: 'xero_bank' }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain(INVOICE_CHANNEL_SETTING_KEY)
    expect(state.inserts).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
  })

  it('lets an empty value through as a clear', async () => {
    state.rows = [{ key: INVOICE_CHANNEL_SETTING_KEY, value: 'xero' }]
    const res = await PATCH(patchReq({ key: INVOICE_CHANNEL_SETTING_KEY, value: '' }))
    expect(res.status).toBe(200)
    // Written, and no longer a rail: GET hands the reader Stripe again.
    expect(state.updates).toHaveLength(1)
    expect(isInvoiceChannel(state.updates[0].value)).toBe(false)
  })

  it('lets a null value through as a clear', async () => {
    state.rows = [{ key: INVOICE_CHANNEL_SETTING_KEY, value: 'xero' }]
    const res = await PATCH(patchReq({ key: INVOICE_CHANNEL_SETTING_KEY, value: null }))
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('value', null)
  })

  it('lets an absent value through as a clear', async () => {
    state.rows = [{ key: INVOICE_CHANNEL_SETTING_KEY, value: 'xero' }]
    const res = await PATCH(patchReq({ key: INVOICE_CHANNEL_SETTING_KEY }))
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('value', null)
  })

  it('leaves every other key alone', async () => {
    const res = await PATCH(patchReq({ key: 'invoicing.prefix', value: 'anything at all' }))
    expect(res.status).toBe(200)
    expect(state.inserts[0]).toMatchObject({ key: 'invoicing.prefix', value: 'anything at all' })
  })
})

// ---------------------------------------------------------------------------
// The pay-path keys (IC.4a)
// ---------------------------------------------------------------------------
//
// The shapes themselves are pinned in lib/__tests__/invoice-pay-settings.test.ts.
// What is pinned HERE is that the route actually runs them and that GET fills
// the mode in the same way it fills the default channel, so no reader has to
// know that an absent row means our own email.
describe('the invoice pay-path settings on /api/admin/settings', () => {
  it('fills the Xero email mode in with the studio default', async () => {
    const res = await GET(getReq())
    const body = await res.json() as { settings: Record<string, string | null> }
    expect(body.settings[XERO_EMAIL_MODE_SETTING_KEY]).toBe(DEFAULT_XERO_EMAIL_MODE)
  })

  it('returns a stored mode, and reads a cleared one as the default', async () => {
    state.rows = [{ key: XERO_EMAIL_MODE_SETTING_KEY, value: 'both' }]
    let body = await (await GET(getReq())).json() as { settings: Record<string, string | null> }
    expect(body.settings[XERO_EMAIL_MODE_SETTING_KEY]).toBe('both')

    state.rows = [{ key: XERO_EMAIL_MODE_SETTING_KEY, value: null }]
    body = await (await GET(getReq())).json() as { settings: Record<string, string | null> }
    expect(body.settings[XERO_EMAIL_MODE_SETTING_KEY]).toBe(DEFAULT_XERO_EMAIL_MODE)
  })

  it('stores the three keys when the value has the right shape', async () => {
    const writes = [
      { key: BANK_DETAILS_SETTING_KEY, value: JSON.stringify({ accountName: 'Tahi Studio Limited', accountNumber: '12-3456-7890123-00' }) },
      { key: XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY, value: '090' },
      { key: XERO_EMAIL_MODE_SETTING_KEY, value: 'both' },
    ]
    for (const write of writes) {
      state.inserts = []
      const res = await PATCH(patchReq(write))
      expect(res.status).toBe(200)
      expect(state.inserts[0]).toMatchObject(write)
    }
  })

  it('400s a bad value on each of them without writing anything', async () => {
    const writes = [
      { key: BANK_DETAILS_SETTING_KEY, value: 'not json' },
      { key: BANK_DETAILS_SETTING_KEY, value: JSON.stringify({ accountNumber: 'ANZ 12-3456' }) },
      { key: XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY, value: 'ANZ Business Account' },
      { key: XERO_EMAIL_MODE_SETTING_KEY, value: 'post' },
    ]
    for (const write of writes) {
      state.inserts = []
      state.updates = []
      const res = await PATCH(patchReq(write))
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain(write.key)
      expect(state.inserts).toHaveLength(0)
      expect(state.updates).toHaveLength(0)
    }
  })

  it('lets an empty value through as the clear on each of them', async () => {
    for (const key of [BANK_DETAILS_SETTING_KEY, XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY, XERO_EMAIL_MODE_SETTING_KEY]) {
      state.rows = [{ key, value: 'whatever was there' }]
      state.updates = []
      const res = await PATCH(patchReq({ key, value: '' }))
      expect(res.status).toBe(200)
      expect(state.updates).toHaveLength(1)
    }
  })
})
