/**
 * POST /api/admin/invoices/xero-sync, the push.
 *
 * One property is pinned here, and it is a client-facing one: the push must
 * never leave a stale Xero pay link on the row.
 *
 * The push sends Status DRAFT, on the UPDATE path as well as the create (Liam,
 * 2026-09-06: auto-approve is a later setting). Re-pushing an invoice Liam has
 * already approved in Xero therefore DEMOTES it, and Xero revokes the online
 * invoice when that happens. invoices.xero_online_invoice_url was write-once,
 * and the syncs only fetch a link when the column is EMPTY, so the row would
 * have kept serving a URL that Xero no longer honours, forever.
 *
 * The other half of the same fix: nothing is captured here. Xero's
 * POST /Invoices response does not carry OnlineInvoiceUrl at all (only
 * GET /Invoices/{id}/OnlineInvoice serves it), so a capture branch on this
 * response could never fire.
 *
 * Same fake D1 as the other route tests: only the chain is thenable and every
 * call is recorded, so a claim is checked against the write that was actually
 * built.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/xero', () => ({
  callXeroAPI: vi.fn().mockResolvedValue(null),
  callXeroAPIOrThrow: vi.fn(),
  XeroAPIError: class XeroAPIError extends Error {},
}))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { callXeroAPI, callXeroAPIOrThrow } from '@/lib/xero'
import { NextRequest } from 'next/server'

import { POST as pushToXero } from '@/app/api/admin/invoices/xero-sync/route'

type QueryRecord = { calls: Array<{ method: string; args: unknown[] }> }

function makeChain(result: unknown, record: QueryRecord): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        record.calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const queries: QueryRecord[] = []
  const queue = [...results]
  const entry = (method: string, args: unknown[]) => {
    const record: QueryRecord = { calls: [{ method, args }] }
    queries.push(record)
    return makeChain(queue.length ? queue.shift() : [], record)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args),
    insert: (...args: unknown[]) => entry('insert', args),
    update: (...args: unknown[]) => entry('update', args),
    delete: (...args: unknown[]) => entry('delete', args),
  }
  return { handle, queries }
}

function argOf(record: QueryRecord | undefined, method: string): unknown {
  return record?.calls.find(c => c.method === method)?.args[0]
}

function byEntry(queries: QueryRecord[], method: string): QueryRecord[] {
  return queries.filter(q => q.calls[0]?.method === method)
}

/** The `.set({...})` payload of the write that links the row to Xero. */
function linkWrite(queries: QueryRecord[]): Record<string, unknown> {
  return (argOf(byEntry(queries, 'update')[0], 'set') ?? {}) as Record<string, unknown>
}

function pushReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/invoices/xero-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The three reads the route makes per invoice: the bill, the org, the lines. */
function ledger(over: Record<string, unknown> = {}) {
  return [
    [{
      id: 'inv-1',
      orgId: 'org-a',
      totalUsd: 1000,
      currency: 'NZD',
      dueDate: '2026-09-30',
      notes: null,
      status: 'draft',
      xeroInvoiceId: null,
      ...over,
    }],
    [{ id: 'org-a', name: 'Kowhai Ltd', xeroContactId: 'contact-1' }],
    [{ description: 'Retainer', quantity: 1, unitPriceUsd: 1000 }],
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' } as never)
  vi.mocked(requireFeature).mockResolvedValue(null)
  // Branding themes: the one call the route makes before the loop.
  vi.mocked(callXeroAPI).mockResolvedValue(null as never)
  vi.mocked(callXeroAPIOrThrow).mockResolvedValue({
    Invoices: [{ InvoiceID: 'xero-1', InvoiceNumber: 'INV-0001', Status: 'DRAFT' }],
  } as never)
})

describe('POST /api/admin/invoices/xero-sync', () => {
  it('refuses a caller who is not a Tahi admin', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client' } as never)
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await pushToXero(pushReq({ invoiceId: 'inv-1' }))
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(0)
  })

  it('nulls any stored pay link when it re-pushes an approved invoice as DRAFT', async () => {
    // The row already carries the link Xero issued when Liam approved it. This
    // push demotes the Xero invoice back to DRAFT, which revokes that link.
    const { handle, queries } = makeDb(ledger({ xeroInvoiceId: 'xero-1', status: 'sent' }))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await pushToXero(pushReq({ invoiceId: 'inv-1' }))
    expect(res.status).toBe(200)

    // It is an update of the existing Xero invoice, and it still sends DRAFT.
    const [, endpoint, payload] = vi.mocked(callXeroAPIOrThrow).mock.calls.at(-1) as [string, string, Record<string, unknown>]
    expect(endpoint).toBe('/Invoices/xero-1')
    const pushed = (payload.Invoices as Array<Record<string, unknown>>)[0]
    expect(pushed.Status).toBe('DRAFT')

    expect(linkWrite(queries)).toMatchObject({
      xeroInvoiceId: 'xero-1',
      source: 'xero',
      xeroOnlineInvoiceUrl: null,
    })
  })

  it('leaves the link null on a first push, which Xero has no link for yet', async () => {
    const { handle, queries } = makeDb(ledger())
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await pushToXero(pushReq({ invoiceId: 'inv-1' }))
    expect(res.status).toBe(200)

    const [, endpoint] = vi.mocked(callXeroAPIOrThrow).mock.calls.at(-1) as [string, string]
    expect(endpoint).toBe('/Invoices')
    expect(linkWrite(queries)).toMatchObject({ xeroOnlineInvoiceUrl: null })
  })

  it('does not try to read a pay link off the create response, which never has one', async () => {
    // Xero serves OnlineInvoiceUrl from GET /Invoices/{id}/OnlineInvoice only.
    // A branch keyed on this response could not fire, and if it ever did it
    // would store a link for the invoice this very call demoted to DRAFT.
    vi.mocked(callXeroAPIOrThrow).mockResolvedValue({
      Invoices: [{
        InvoiceID: 'xero-1',
        InvoiceNumber: 'INV-0001',
        Status: 'DRAFT',
        OnlineInvoiceUrl: 'https://in.xero.com/should-be-ignored',
      }],
    } as never)
    const { handle, queries } = makeDb(ledger({ xeroInvoiceId: 'xero-1' }))
    vi.mocked(db).mockResolvedValue(handle as never)

    await pushToXero(pushReq({ invoiceId: 'inv-1' }))

    expect(linkWrite(queries).xeroOnlineInvoiceUrl).toBeNull()
  })

  it('writes nothing on a dry run', async () => {
    const { handle, queries } = makeDb(ledger())
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await pushToXero(pushReq({ invoiceId: 'inv-1', dryRun: true }))
    expect(res.status).toBe(200)
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(callXeroAPIOrThrow).not.toHaveBeenCalled()
  })
})
