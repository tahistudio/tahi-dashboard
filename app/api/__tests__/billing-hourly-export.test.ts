/**
 * POST /api/admin/billing/xero-export, the hourly-to-Xero export.
 *
 * Four properties are pinned here, and every one of them is money:
 *
 *   1. Hours that have already been exported are never exported again. The
 *      route filters on time_entries.invoice_id IS NULL (migration 0095) and
 *      stamps every entry it bills, so a re-run of the same month produces zero
 *      lines and says so instead of silently raising a second bill.
 *   2. Only a client whose billing model is hourly is invoiced by the hour. A
 *      retainer client's hours are already paid for, so billing them again is
 *      charging twice, and the skip has to be visible.
 *   3. Lines are built in the client's own currency, and hours belonging to a
 *      client billed in a different one refuse the export rather than being
 *      silently converted.
 *   4. A missing or zero rate refuses the client's export and returns the entry
 *      ids. The old route dropped those clients with a bare `continue`.
 *
 * Same fake D1 as the other route tests: only the chain is thenable, every call
 * is recorded, and the reads are answered from a queue in the order the route
 * makes them (candidates, already exported, organisations), so a claim is
 * checked against the write that was actually built.
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
import { callXeroAPI } from '@/lib/xero'
import { NextRequest } from 'next/server'

import { POST as exportHourly } from '@/app/api/admin/billing/xero-export/route'

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

/**
 * Every bound parameter inside a Drizzle SQL fragment, in order. Used to prove
 * an `inArray(...)` targeted the entry ids it claims to, without needing a
 * dialect to render the statement.
 */
function boundValues(node: unknown, seen = new Set<unknown>()): unknown[] {
  if (node === null || typeof node !== 'object') return []
  if (seen.has(node)) return []
  seen.add(node)
  if (Array.isArray(node)) return node.flatMap(child => boundValues(child, seen))
  const record = node as Record<string, unknown>
  if ('value' in record && !('queryChunks' in record)) return [record.value]
  return Object.values(record).flatMap(child => boundValues(child, seen))
}

function exportReq(body?: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/billing/xero-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function org(over: Record<string, unknown> = {}) {
  return {
    id: 'org-a',
    name: 'Kowhai Ltd',
    xeroContactId: 'contact-1',
    defaultHourlyRate: 150,
    preferredCurrency: 'NZD',
    billingModel: 'hourly',
    ...over,
  }
}

function entryRow(over: Record<string, unknown> = {}) {
  return {
    id: 'te-1',
    orgId: 'org-a',
    hours: 4,
    hourlyRate: 150,
    requestOrgId: 'org-a',
    ...over,
  }
}

/** The three reads the route makes: candidates, already exported, orgs. */
function reads(
  candidates: unknown[],
  alreadyExported: unknown[],
  orgs: unknown[],
): unknown[] {
  return [candidates, alreadyExported, orgs]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' } as never)
  vi.mocked(requireFeature).mockResolvedValue(null)
  vi.mocked(callXeroAPI).mockResolvedValue({
    Invoices: [{ InvoiceID: 'xero-1', InvoiceNumber: 'INV-0001' }],
  } as never)
})

describe('POST /api/admin/billing/xero-export', () => {
  it('refuses a caller who is not a Tahi admin', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client' } as never)
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08' }))

    expect(res.status).toBe(403)
    expect(queries).toHaveLength(0)
  })

  it('rejects a month that is not a real calendar month', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-13' }))
    const json = await res.json() as { error: string }

    expect(res.status).toBe(400)
    expect(json.error).toContain('YYYY-MM')
    expect(queries).toHaveLength(0)
  })

  it('defaults to a dry run: writes nothing and calls Xero for nobody', async () => {
    const { handle, queries } = makeDb(reads([entryRow()], [], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08' }))
    const json = await res.json() as {
      dryRun: boolean
      invoiceCount: number
      invoices: Array<{ status: string; amount: number; currency: string }>
    }

    expect(json.dryRun).toBe(true)
    expect(json.invoiceCount).toBe(1)
    expect(json.invoices[0].status).toBe('dry_run')
    expect(json.invoices[0].amount).toBe(600)
    expect(json.invoices[0].currency).toBe('NZD')
    expect(byEntry(queries, 'insert')).toHaveLength(0)
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(callXeroAPI).not.toHaveBeenCalled()
  })

  it('a month whose entries were already exported yields zero lines and says why', async () => {
    const { handle, queries } = makeDb(reads(
      [],
      [{ id: 'te-1', orgId: 'org-a' }, { id: 'te-2', orgId: 'org-a' }],
      [org()],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as {
      invoiceCount: number
      invoices: unknown[]
      skipped: Array<{ orgId: string; reason: string; message: string }>
    }

    expect(json.invoiceCount).toBe(0)
    expect(json.invoices).toEqual([])
    expect(json.skipped).toHaveLength(1)
    expect(json.skipped[0].reason).toBe('already_exported')
    expect(json.skipped[0].orgId).toBe('org-a')
    expect(json.skipped[0].message).toContain('2 billable entries')
    expect(byEntry(queries, 'insert')).toHaveLength(0)
    expect(callXeroAPI).not.toHaveBeenCalled()
  })

  it('skips a retainer client by name instead of billing their hours twice', async () => {
    const { handle, queries } = makeDb(reads(
      [entryRow(), entryRow({ id: 'te-2' })],
      [],
      [org({ billingModel: 'retainer' })],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as {
      invoiceCount: number
      skipped: Array<{ orgName: string; reason: string; message: string; entryIds: string[] }>
    }

    expect(json.invoiceCount).toBe(0)
    expect(json.skipped[0].reason).toBe('billing_model_not_hourly')
    expect(json.skipped[0].orgName).toBe('Kowhai Ltd')
    expect(json.skipped[0].message).toContain('billed as retainer')
    expect(json.skipped[0].entryIds).toEqual(['te-1', 'te-2'])
    expect(byEntry(queries, 'insert')).toHaveLength(0)
  })

  it('skips a client whose billing model has never been set', async () => {
    const { handle } = makeDb(reads([entryRow()], [], [org({ billingModel: null })]))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as { skipped: Array<{ reason: string; message: string }> }

    expect(json.skipped[0].reason).toBe('billing_model_not_set')
    expect(json.skipped[0].message).toContain('no billing model set')
  })

  it('refuses a client whose hours belong to a client billed in another currency', async () => {
    const { handle, queries } = makeDb(reads(
      [entryRow(), entryRow({ id: 'te-2', requestOrgId: 'org-b' })],
      [],
      [org(), org({ id: 'org-b', name: 'Rimu Co', preferredCurrency: 'USD' })],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as {
      invoiceCount: number
      skipped: Array<{ reason: string; message: string; entryIds: string[] }>
    }

    expect(json.invoiceCount).toBe(0)
    expect(json.skipped[0].reason).toBe('currency_mismatch')
    expect(json.skipped[0].entryIds).toEqual(['te-2'])
    expect(json.skipped[0].message).toContain('NZD')
    expect(byEntry(queries, 'insert')).toHaveLength(0)
  })

  it('refuses a client billed in a currency the studio has no rate card for', async () => {
    const { handle } = makeDb(reads([entryRow()], [], [org({ preferredCurrency: 'ZWL' })]))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as { skipped: Array<{ reason: string; message: string }> }

    expect(json.skipped[0].reason).toBe('unsupported_currency')
    expect(json.skipped[0].message).toContain('ZWL')
  })

  it('refuses a client with an unbillable rate and names the entries', async () => {
    const { handle, queries } = makeDb(reads(
      [
        entryRow({ id: 'te-1', hourlyRate: null }),
        entryRow({ id: 'te-2', hourlyRate: 0 }),
        entryRow({ id: 'te-3', hourlyRate: 150 }),
      ],
      [],
      [org({ defaultHourlyRate: null })],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as {
      invoiceCount: number
      skipped: Array<{ reason: string; message: string; entryIds: string[] }>
    }

    expect(json.invoiceCount).toBe(0)
    expect(json.skipped[0].reason).toBe('missing_rate')
    expect(json.skipped[0].entryIds).toEqual(['te-1', 'te-2'])
    expect(json.skipped[0].message).toContain('te-1, te-2')
    expect(byEntry(queries, 'insert')).toHaveLength(0)
  })

  it('falls a null rate back to the client default rather than dropping the entry', async () => {
    const { handle } = makeDb(reads(
      [entryRow({ id: 'te-1', hourlyRate: null, hours: 2 })],
      [],
      [org({ defaultHourlyRate: 200 })],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08' }))
    const json = await res.json() as {
      invoices: Array<{ amount: number; lines: Array<{ rate: number; description: string }> }>
    }

    expect(json.invoices[0].amount).toBe(400)
    expect(json.invoices[0].lines[0].rate).toBe(200)
    expect(json.invoices[0].lines[0].description).toContain('at NZ$200/hr')
  })

  it('refuses hours that are negative rather than taking money off the bill', async () => {
    const { handle } = makeDb(reads([entryRow({ id: 'te-9', hours: -3 })], [], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as { skipped: Array<{ reason: string; entryIds: string[] }> }

    expect(json.skipped[0].reason).toBe('invalid_hours')
    expect(json.skipped[0].entryIds).toEqual(['te-9'])
  })

  it('builds one line per rate, in the client currency, and marks every entry it bills', async () => {
    const { handle, queries } = makeDb(reads(
      [
        entryRow({ id: 'te-1', hours: 4, hourlyRate: 150 }),
        entryRow({ id: 'te-2', hours: 2, hourlyRate: 150 }),
        entryRow({ id: 'te-3', hours: 1, hourlyRate: 250 }),
      ],
      [],
      [org({ preferredCurrency: 'USD' })],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as {
      dryRun: boolean
      invoiceCount: number
      invoices: Array<{
        invoiceId: string
        status: string
        xeroStatus: string
        currency: string
        hours: number
        amount: number
        entryIds: string[]
        lines: Array<{ description: string; hours: number; rate: number; amount: number }>
      }>
    }

    expect(json.dryRun).toBe(false)
    expect(json.invoiceCount).toBe(1)
    const invoice = json.invoices[0]
    expect(invoice.status).toBe('created')
    expect(invoice.xeroStatus).toBe('synced')
    expect(invoice.currency).toBe('USD')
    expect(invoice.hours).toBe(7)
    expect(invoice.amount).toBe(1150)
    expect(invoice.entryIds).toEqual(['te-1', 'te-2', 'te-3'])
    expect(invoice.lines).toHaveLength(2)
    expect(invoice.lines[0]).toMatchObject({ rate: 250, hours: 1, amount: 250 })
    expect(invoice.lines[0].description).toContain('1.0 hours at US$250/hr')
    expect(invoice.lines[1]).toMatchObject({ rate: 150, hours: 6, amount: 900 })

    // The invoice row carries the client's currency, not a hardcoded NZD.
    const inserts = byEntry(queries, 'insert')
    const invoiceValues = argOf(inserts[0], 'values') as Record<string, unknown>
    expect(invoiceValues.currency).toBe('USD')
    expect(invoiceValues.totalUsd).toBe(1150)
    expect(invoiceValues.orgId).toBe('org-a')
    expect(invoiceValues.status).toBe('draft')
    // One insert per rate, not one aggregate line at whichever rate came last.
    expect(inserts).toHaveLength(3)
    expect((argOf(inserts[1], 'values') as Record<string, unknown>).unitPriceUsd).toBe(250)
    expect((argOf(inserts[2], 'values') as Record<string, unknown>).unitPriceUsd).toBe(150)

    // Every billed entry is stamped with the invoice, which is what stops the
    // next run over the same month billing these hours again.
    const stamp = byEntry(queries, 'update')[0]
    const setPayload = argOf(stamp, 'set') as Record<string, unknown>
    expect(setPayload.invoiceId).toBe(invoice.invoiceId)
    expect(typeof setPayload.invoicedAt).toBe('string')
    const targeted = boundValues(argOf(stamp, 'where'))
    expect(targeted).toEqual(expect.arrayContaining(['te-1', 'te-2', 'te-3']))

    // Xero gets the same currency and both lines.
    const payload = vi.mocked(callXeroAPI).mock.calls[0][2] as {
      Invoices: Array<{ CurrencyCode: string; LineAmountTypes: string; LineItems: unknown[] }>
    }
    expect(payload.Invoices[0].CurrencyCode).toBe('USD')
    expect(payload.Invoices[0].LineAmountTypes).toBe('NoTax')
    expect(payload.Invoices[0].LineItems).toHaveLength(2)
  })

  it('stamps the entries even when the Xero push fails, so the hours are billed once', async () => {
    vi.mocked(callXeroAPI).mockResolvedValue(null as never)
    const { handle, queries } = makeDb(reads([entryRow()], [], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as { invoices: Array<{ xeroStatus: string }> }

    expect(json.invoices[0].xeroStatus).toBe('xero_failed')
    const setPayload = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(setPayload.invoiceId).toEqual(expect.any(String))
  })

  it('bills locally and reports the gap when the client has no Xero contact', async () => {
    const { handle } = makeDb(reads([entryRow()], [], [org({ xeroContactId: null })]))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as { invoices: Array<{ xeroStatus: string }> }

    expect(json.invoices[0].xeroStatus).toBe('no_xero_contact')
    expect(callXeroAPI).not.toHaveBeenCalled()
  })

  it('reports nothing at all when the month holds no billable time', async () => {
    const { handle, queries } = makeDb(reads([], [], []))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await exportHourly(exportReq({ month: '2026-08', dryRun: false }))
    const json = await res.json() as { invoiceCount: number; skippedCount: number }

    expect(json.invoiceCount).toBe(0)
    expect(json.skippedCount).toBe(0)
    // Two reads and no organisations lookup: there was nobody to look up.
    expect(byEntry(queries, 'select')).toHaveLength(2)
  })
})
