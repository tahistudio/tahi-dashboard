/**
 * POST /api/admin/time/stamp-invoiced, IC.8's pre-cutover stamp.
 *
 * Before the first non-dry hourly Xero export (IC.6 / CT.13) runs over a
 * historical period, hours already invoiced by hand carry invoice_id NULL the
 * same as hours never invoiced at all (migration 0095 shipped with no
 * backfill). This route marks the former as accounted for with
 * invoiced_at = now, leaves invoice_id NULL (there is no local invoice for
 * them), and never touches Xero.
 *
 * Same fake D1 as the other route tests: only the chain is thenable, every
 * call is recorded, and the reads are answered from a queue in the order the
 * route makes them (entries on or before the cutoff, then the orgs they
 * belong to).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest } from 'next/server'

import { POST as stampInvoiced } from '@/app/api/admin/time/stamp-invoiced/route'

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

/** Every bound parameter inside a Drizzle SQL fragment, in order. */
function boundValues(node: unknown, seen = new Set<unknown>()): unknown[] {
  if (node === null || typeof node !== 'object') return []
  if (seen.has(node)) return []
  seen.add(node)
  if (Array.isArray(node)) return node.flatMap(child => boundValues(child, seen))
  const record = node as Record<string, unknown>
  if ('value' in record && !('queryChunks' in record)) return [record.value]
  return Object.values(record).flatMap(child => boundValues(child, seen))
}

function stampReq(body?: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/time/stamp-invoiced', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function org(over: Record<string, unknown> = {}) {
  return { id: 'org-a', name: 'Kowhai Ltd', ...over }
}

function entryRow(over: Record<string, unknown> = {}) {
  return {
    id: 'te-1',
    orgId: 'org-a',
    hours: 4,
    hourlyRate: 150,
    invoiceId: null,
    invoicedAt: null,
    ...over,
  }
}

/** The two reads the route makes when there is at least one org: entries, orgs. */
function reads(entries: unknown[], orgs: unknown[]): unknown[] {
  return [entries, orgs]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' } as never)
  vi.mocked(requireFeature).mockResolvedValue(null)
})

describe('POST /api/admin/time/stamp-invoiced', () => {
  it('refuses a caller who is not a Tahi admin', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client' } as never)
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-08-31' }))

    expect(res.status).toBe(403)
    expect(queries).toHaveLength(0)
  })

  it('rejects a body with no before date', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({}))
    const json = await res.json() as { error: string }

    expect(res.status).toBe(400)
    expect(json.error).toContain('before')
    expect(queries).toHaveLength(0)
  })

  it('rejects a before date that is not YYYY-MM-DD', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '31 Aug 2026' }))

    expect(res.status).toBe(400)
    expect(queries).toHaveLength(0)
  })

  it('rejects a before date with a month outside 1 to 12', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-13-01' }))
    const json = await res.json() as { error: string }

    expect(res.status).toBe(400)
    expect(json.error).toContain('calendar date')
    expect(queries).toHaveLength(0)
  })

  it('rejects a before date with a day outside the month (2026-02-30, not a leap year)', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-02-30' }))
    const json = await res.json() as { error: string }

    expect(res.status).toBe(400)
    expect(json.error).toContain('calendar date')
    expect(queries).toHaveLength(0)
  })

  it('accepts 2024-02-29, a real leap day', async () => {
    const { handle } = makeDb(reads([entryRow()], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2024-02-29' }))

    expect(res.status).toBe(200)
  })

  it('defaults to a dry run: plans without writing anything', async () => {
    const { handle, queries } = makeDb(reads([entryRow()], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-08-31' }))
    const json = await res.json() as {
      dryRun: boolean
      planCount: number
      stampedCount: number
      plans: Array<{ orgName: string; hours: number; entryCount: number }>
    }

    expect(json.dryRun).toBe(true)
    expect(json.planCount).toBe(1)
    expect(json.plans[0]).toMatchObject({ orgName: 'Kowhai Ltd', hours: 4, entryCount: 1 })
    expect(json.stampedCount).toBe(0)
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(byEntry(queries, 'insert')).toHaveLength(0)
  })

  it('uses the cutoff date itself in the where clause, inclusive of the boundary', async () => {
    const { handle, queries } = makeDb(reads([entryRow()], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    await stampInvoiced(stampReq({ before: '2026-08-31' }))

    const entrySelect = byEntry(queries, 'select')[0]
    const where = argOf(entrySelect, 'where')
    expect(boundValues(where)).toEqual(expect.arrayContaining(['2026-08-31']))
  })

  it('plans per organisation, grouping hours and rates separately for each', async () => {
    const { handle } = makeDb(reads(
      [
        entryRow({ id: 'te-1', orgId: 'org-a', hours: 4, hourlyRate: 150 }),
        entryRow({ id: 'te-2', orgId: 'org-a', hours: 2, hourlyRate: 200 }),
        entryRow({ id: 'te-3', orgId: 'org-b', hours: 6, hourlyRate: 100 }),
      ],
      [org(), org({ id: 'org-b', name: 'Rimu Co' })],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-08-31' }))
    const json = await res.json() as {
      planCount: number
      plans: Array<{ orgId: string; orgName: string; hours: number; entryCount: number; rates: Array<{ rate: number | null; hours: number; entryCount: number }> }>
    }

    expect(json.planCount).toBe(2)
    const orgAPlan = json.plans.find(p => p.orgId === 'org-a')
    const orgBPlan = json.plans.find(p => p.orgId === 'org-b')
    expect(orgAPlan).toMatchObject({ orgName: 'Kowhai Ltd', hours: 6, entryCount: 2 })
    expect(orgAPlan?.rates).toEqual(expect.arrayContaining([
      { rate: 150, hours: 4, entryCount: 1 },
      { rate: 200, hours: 2, entryCount: 1 },
    ]))
    expect(orgBPlan).toMatchObject({ orgName: 'Rimu Co', hours: 6, entryCount: 1 })
  })

  it('refuses entries that already carry a local invoice, and never plans to restamp them', async () => {
    const { handle, queries } = makeDb(reads(
      [
        entryRow({ id: 'te-1', invoiceId: 'inv-1' }),
        entryRow({ id: 'te-2', invoiceId: null }),
      ],
      [org()],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-08-31', dryRun: false }))
    const json = await res.json() as {
      planCount: number
      plans: Array<{ entryIds: string[] }>
      skipped: Array<{ reason: string; entryIds: string[] }>
    }

    expect(json.planCount).toBe(1)
    expect(json.plans[0].entryIds).toEqual(['te-2'])
    const refusal = json.skipped.find(s => s.reason === 'already_invoiced')
    expect(refusal?.entryIds).toEqual(['te-1'])

    // Only the eligible entry is targeted by the update.
    const stamp = byEntry(queries, 'update')[0]
    const targeted = boundValues(argOf(stamp, 'where'))
    expect(targeted).toEqual(expect.arrayContaining(['te-2']))
    expect(targeted).not.toContain('te-1')
  })

  it('reports an entry already stamped by an earlier run separately, and does not restamp it', async () => {
    const { handle, queries } = makeDb(reads(
      [entryRow({ id: 'te-1', invoiceId: null, invoicedAt: '2026-09-01T00:00:00.000Z' })],
      [org()],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-08-31', dryRun: false }))
    const json = await res.json() as {
      planCount: number
      stampedCount: number
      skipped: Array<{ reason: string; entryIds: string[] }>
    }

    expect(json.planCount).toBe(0)
    expect(json.stampedCount).toBe(0)
    expect(json.skipped[0].reason).toBe('already_stamped')
    expect(json.skipped[0].entryIds).toEqual(['te-1'])
    expect(byEntry(queries, 'update')).toHaveLength(0)
  })

  it('applying stamps invoiced_at and leaves invoice_id untouched (never sets it)', async () => {
    const { handle, queries } = makeDb(reads([entryRow({ id: 'te-1' })], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-08-31', dryRun: false }))
    const json = await res.json() as { dryRun: boolean; stampedCount: number }

    expect(json.dryRun).toBe(false)
    expect(json.stampedCount).toBe(1)

    const stamp = byEntry(queries, 'update')[0]
    const setPayload = argOf(stamp, 'set') as Record<string, unknown>
    expect(typeof setPayload.invoicedAt).toBe('string')
    expect(setPayload).not.toHaveProperty('invoiceId')
  })

  it('writes one audit row naming IC.8 as the reason when it applies', async () => {
    const { handle, queries } = makeDb(reads([entryRow({ id: 'te-1' })], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    await stampInvoiced(stampReq({ before: '2026-08-31', dryRun: false }))

    const inserts = byEntry(queries, 'insert')
    expect(inserts).toHaveLength(1)
    const values = argOf(inserts[0], 'values') as { action: string; metadata: string }
    expect(values.action).toBe('time_entries_stamp_invoiced')
    const metadata = JSON.parse(values.metadata) as { reason: string; before: string; stampedCount: number }
    expect(metadata.reason).toContain('IC.8')
    expect(metadata.before).toBe('2026-08-31')
    expect(metadata.stampedCount).toBe(1)
  })

  it('writes no audit row when nothing was eligible to stamp', async () => {
    const { handle, queries } = makeDb(reads(
      [entryRow({ id: 'te-1', invoiceId: 'inv-1' })],
      [org()],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-08-31', dryRun: false }))
    const json = await res.json() as { stampedCount: number }

    expect(json.stampedCount).toBe(0)
    expect(byEntry(queries, 'insert')).toHaveLength(0)
    expect(byEntry(queries, 'update')).toHaveLength(0)
  })

  it('a second apply over the same cutoff stamps nothing new (idempotent)', async () => {
    // First run's rows now carry invoicedAt, exactly as the update would have
    // left them: the second call over the same cutoff sees only already_stamped.
    const { handle, queries } = makeDb(reads(
      [entryRow({ id: 'te-1', invoicedAt: '2026-09-13T00:00:00.000Z' })],
      [org()],
    ))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-08-31', dryRun: false }))
    const json = await res.json() as { stampedCount: number; skipped: Array<{ reason: string }> }

    expect(json.stampedCount).toBe(0)
    expect(json.skipped[0].reason).toBe('already_stamped')
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(byEntry(queries, 'insert')).toHaveLength(0)
  })

  it('scopes to a single organisation when orgId is given', async () => {
    const { handle, queries } = makeDb(reads([entryRow({ orgId: 'org-a' })], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    await stampInvoiced(stampReq({ before: '2026-08-31', orgId: 'org-a' }))

    const entrySelect = byEntry(queries, 'select')[0]
    const where = argOf(entrySelect, 'where')
    expect(boundValues(where)).toEqual(expect.arrayContaining(['org-a']))
  })

  it('never calls out to Xero: no fetch, no invoice row', async () => {
    const { handle, queries } = makeDb(reads([entryRow()], [org()]))
    vi.mocked(db).mockResolvedValue(handle as never)

    await stampInvoiced(stampReq({ before: '2026-08-31', dryRun: false }))

    // Only an update (the stamp) and an insert (the audit row): never an
    // invoice or invoiceItems row.
    expect(byEntry(queries, 'insert')).toHaveLength(1)
    expect(byEntry(queries, 'update')).toHaveLength(1)
  })

  it('reports nothing at all when the cutoff holds no billable time', async () => {
    const { handle, queries } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stampInvoiced(stampReq({ before: '2026-08-31', dryRun: false }))
    const json = await res.json() as { planCount: number; skippedCount: number }

    expect(json.planCount).toBe(0)
    expect(json.skippedCount).toBe(0)
    // One read only: there was nobody to look up an org for.
    expect(byEntry(queries, 'select')).toHaveLength(1)
  })
})
