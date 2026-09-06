/**
 * Invoice numbering at the two doors that write it: the create rail and the
 * backfill.
 *
 * POST /api/admin/invoices
 *   The studio raising a bill mints from its own sequence, so the row carries a
 *   number and the response returns it. The counter is a settings row bumped by
 *   one atomic UPDATE ... RETURNING, which is what makes two simultaneous
 *   invoices two different numbers rather than one number twice; the unique
 *   index on invoices.number is the backstop, and a collision must retry rather
 *   than fail the bill or write a duplicate.
 *
 * POST /api/admin/invoices/backfill-numbers
 *   dryRun DEFAULTS TO TRUE and must write NOTHING. It recovers the number an
 *   imported row was born with and refuses everything else BY NAME. It never
 *   mints a sequence number for a historical row, which is the one thing that
 *   would put a document number on a bill that never carried it.
 *
 * Same fake D1 as the other route tests: only the chain is thenable, every call
 * is recorded, and reads are answered from a queue in the order the route makes
 * them, so a claim is checked against the write that was actually built. This
 * handle also answers `all` and `run`, because the mint issues raw SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
  getOrgScope: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest } from 'next/server'

import { POST as createInvoice } from '@/app/api/admin/invoices/route'
import { POST as backfillNumbers } from '@/app/api/admin/invoices/backfill-numbers/route'

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

interface FakeDbOptions {
  /** Reads answered in the order the route makes them. */
  results?: unknown[]
  /** Settings prefix row, as `SELECT value FROM settings` would return it. */
  prefix?: string | null
  /** Throw this on the Nth invoice insert (1-based), to stand in for a conflict. */
  failInsertAttempts?: number
  /** Throw this on every update, to stand in for a refused backfill write. */
  failUpdates?: boolean
}

function makeDb(options: FakeDbOptions = {}) {
  const queries: QueryRecord[] = []
  const queue = [...(options.results ?? [])]
  const statements: string[] = []
  let sequence = 0
  let insertAttempts = 0

  const entry = (method: string, args: unknown[]) => {
    const record: QueryRecord = { calls: [{ method, args }] }
    queries.push(record)

    if (method === 'insert' && insertAttempts < (options.failInsertAttempts ?? 0)) {
      insertAttempts++
      return makeChain(
        Promise.reject(new Error('D1_ERROR: UNIQUE constraint failed: invoices.number')),
        record,
      )
    }
    if (method === 'insert') insertAttempts++
    if (method === 'update' && options.failUpdates) {
      return makeChain(Promise.reject(new Error('D1_ERROR: UNIQUE constraint failed: invoices.number')), record)
    }
    return makeChain(queue.length ? queue.shift() : [], record)
  }

  const handle = {
    select: (...args: unknown[]) => entry('select', args),
    insert: (...args: unknown[]) => entry('insert', args),
    update: (...args: unknown[]) => entry('update', args),
    delete: (...args: unknown[]) => entry('delete', args),
    // The mint's two raw statements. `all` answers the prefix read and the
    // atomic counter bump; `run` seeds the counter row.
    all: async (query: unknown) => {
      const text = renderSql(query)
      statements.push(text)
      if (text.startsWith('SELECT')) {
        return options.prefix === undefined ? [] : [{ value: options.prefix }]
      }
      sequence++
      return [{ value: String(sequence) }]
    },
    run: async (query: unknown) => {
      statements.push(renderSql(query))
      return undefined
    },
  }

  return { handle, queries, statements }
}

/** Enough of a Drizzle SQL template to tell an UPDATE from a SELECT. */
function renderSql(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? []
  const out: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') { out.push(node); return }
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (Array.isArray(record.value)) { record.value.forEach(walk); return }
      if (Array.isArray(record.queryChunks)) { record.queryChunks.forEach(walk); return }
    }
  }
  chunks.forEach(walk)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

function argOf(record: QueryRecord | undefined, method: string): unknown {
  return record?.calls.find(c => c.method === method)?.args[0]
}

function byEntry(queries: QueryRecord[], method: string): QueryRecord[] {
  return queries.filter(q => q.calls[0]?.method === method)
}

/** Every `.values({...})` payload written to the invoices table, in order. */
function invoiceWrites(queries: QueryRecord[]): Array<Record<string, unknown>> {
  return byEntry(queries, 'insert')
    .map(q => argOf(q, 'values'))
    .filter((v): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v) && 'totalUsd' in v)
}

function createReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function backfillReq(body?: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/invoices/backfill-numbers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const LINE_ITEMS = [{ description: 'Retainer', quantity: 1, unitAmount: 1000 }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' } as never)
  vi.mocked(requireFeature).mockResolvedValue(null)
})

// ── The create rail ──────────────────────────────────────────────────────────

describe('POST /api/admin/invoices, minting', () => {
  it('stamps a number in the expected format and returns it', async () => {
    const { handle, queries } = makeDb({ prefix: 'INV-' })
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await createInvoice(createReq({ orgId: 'org-a', lineItems: LINE_ITEMS }))
    const body = await res.json() as { id: string; number: string | null }

    const year = new Date().getFullYear()
    expect(body.number).toBe(`INV-${year}-0001`)
    expect(invoiceWrites(queries)[0].number).toBe(`INV-${year}-0001`)
  })

  it('increments across two invoices', async () => {
    const { handle } = makeDb({ prefix: 'INV-' })
    vi.mocked(db).mockResolvedValue(handle as never)

    const first = await (await createInvoice(createReq({ orgId: 'org-a', lineItems: LINE_ITEMS }))).json() as { number: string }
    const second = await (await createInvoice(createReq({ orgId: 'org-a', lineItems: LINE_ITEMS }))).json() as { number: string }

    expect(first.number).not.toBe(second.number)
    expect(second.number.endsWith('0002')).toBe(true)
  })

  it('bumps the counter with ONE atomic statement, never a read then a write', async () => {
    // The property the whole design rests on. A SELECT of the counter followed
    // by an UPDATE is the race: two invoices raised in the same second would
    // both read the same value and both take it.
    const { handle, statements } = makeDb({ prefix: 'INV-' })
    vi.mocked(db).mockResolvedValue(handle as never)

    await createInvoice(createReq({ orgId: 'org-a', lineItems: LINE_ITEMS }))

    const bump = statements.find(s => s.startsWith('UPDATE settings'))
    expect(bump).toBeDefined()
    expect(bump).toContain('RETURNING value')
    expect(statements.filter(s => s.includes('numberSequence') && s.startsWith('SELECT'))).toHaveLength(0)
  })

  it('retries once on a unique conflict and writes the NEXT number', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handle, queries } = makeDb({ prefix: 'INV-', failInsertAttempts: 1 })
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await createInvoice(createReq({ orgId: 'org-a', lineItems: LINE_ITEMS }))
    expect(res.status).toBe(200)
    const body = await res.json() as { number: string }

    const written = invoiceWrites(queries)
    expect(written).toHaveLength(2)
    expect(written[0].number).not.toBe(written[1].number)
    expect(body.number).toBe(written[1].number)
    // Same invoice id both times: the failed insert wrote nothing, so the
    // retry is the same bill under a new number, not a second bill.
    expect(written[0].id).toBe(written[1].id)
    errorSpy.mockRestore()
  })

  it('writes the LINE ITEMS once, outside the retry', async () => {
    // The conflict is only ever on the invoice row. Putting the lines inside
    // the retry would double them on the second attempt.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handle, queries } = makeDb({ prefix: 'INV-', failInsertAttempts: 1 })
    vi.mocked(db).mockResolvedValue(handle as never)

    await createInvoice(createReq({ orgId: 'org-a', lineItems: LINE_ITEMS }))

    const lineWrites = byEntry(queries, 'insert')
      .map(q => argOf(q, 'values'))
      .filter(Array.isArray)
    expect(lineWrites).toHaveLength(1)
    errorSpy.mockRestore()
  })

  it('still raises the invoice when the counter cannot be reached', async () => {
    // A settings row that will not increment is not a reason to refuse to bill
    // a client. Every reader falls back to the short id.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handle, queries } = makeDb({ prefix: 'INV-' })
    handle.all = async () => { throw new Error('D1_ERROR: no such table: settings') }
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await createInvoice(createReq({ orgId: 'org-a', lineItems: LINE_ITEMS }))
    expect(res.status).toBe(200)
    const body = await res.json() as { id: string; number: string | null }

    expect(body.number).toBeNull()
    expect(body.id).toBeTruthy()
    expect(invoiceWrites(queries)[0].number).toBeNull()
    errorSpy.mockRestore()
  })
})

// ── The backfill ─────────────────────────────────────────────────────────────

/** The two reads the backfill makes: unnumbered candidates, then every number. */
function ledger(candidates: unknown[], taken: unknown[] = []) {
  return [candidates, taken]
}

describe('POST /api/admin/invoices/backfill-numbers', () => {
  it('refuses a caller who is not a Tahi admin', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client' } as never)
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await backfillNumbers(backfillReq())
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(0)
  })

  it('DEFAULTS to a dry run and writes nothing', async () => {
    const { handle, queries } = makeDb({
      results: ledger(
        [{ id: 'a', number: null, notes: 'Imported from Xero: INV-0431', manyrequestsId: null }],
        [{ number: null }],
      ),
    })
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await backfillNumbers(backfillReq())
    const body = await res.json() as {
      dryRun: boolean
      scanned: number
      filledCount: number
      filled: Array<{ id: string; number: string; origin: string }>
    }

    expect(body.dryRun).toBe(true)
    expect(body.scanned).toBe(1)
    expect(body.filledCount).toBe(1)
    expect(body.filled[0]).toEqual({ id: 'a', number: 'INV-0431', origin: 'xero' })
    // The plan is reported and the ledger is untouched.
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(byEntry(queries, 'insert')).toHaveLength(0)
  })

  it('an unqualified call is a dry run even with a body that says nothing', async () => {
    const { handle, queries } = makeDb({ results: ledger([], []) })
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await backfillNumbers(backfillReq({}))).json() as { dryRun: boolean }
    expect(body.dryRun).toBe(true)
    expect(byEntry(queries, 'update')).toHaveLength(0)
  })

  it('rejects a non-boolean dryRun rather than guessing', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await backfillNumbers(backfillReq({ dryRun: 'no' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'dryRun must be true or false' })
    expect(queries).toHaveLength(0)
  })

  it('writes the recovered numbers when dryRun is false, guarded on still being NULL', async () => {
    const { handle, queries } = makeDb({
      results: ledger(
        [{ id: 'a', number: null, notes: null, manyrequestsId: 'INV-2025000024' }],
        [{ number: null }],
      ),
    })
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await backfillNumbers(backfillReq({ dryRun: false }))).json() as {
      dryRun: boolean
      filledCount: number
    }

    expect(body.dryRun).toBe(false)
    expect(body.filledCount).toBe(1)
    const writes = byEntry(queries, 'update')
    expect(writes).toHaveLength(1)
    expect(argOf(writes[0], 'set')).toMatchObject({ number: 'INV-2025000024' })
  })

  it('never mints for a dashboard-raised historical row, and says so', async () => {
    // The refusal IS the feature. Handing this bill an INV-2026-xxxx from
    // today's counter would invent a number that appears on nothing the client
    // holds, and burn a live sequence value on history.
    const { handle, queries } = makeDb({
      results: ledger(
        [{ id: 'a', number: null, notes: 'Raised from onboarding', manyrequestsId: null }],
        [{ number: null }],
      ),
    })
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await backfillNumbers(backfillReq({ dryRun: false }))).json() as {
      filledCount: number
      refusedCount: number
      refused: Array<{ id: string; reason: string; message: string }>
    }

    expect(body.filledCount).toBe(0)
    expect(body.refusedCount).toBe(1)
    expect(body.refused[0]).toMatchObject({ id: 'a', reason: 'no_source_number' })
    expect(byEntry(queries, 'update')).toHaveLength(0)
  })

  it('reports a write it could not make instead of claiming the row was filled', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handle } = makeDb({
      results: ledger(
        [{ id: 'a', number: null, notes: 'Imported from Xero: INV-0431', manyrequestsId: null }],
        [{ number: null }],
      ),
      failUpdates: true,
    })
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await backfillNumbers(backfillReq({ dryRun: false }))).json() as {
      filledCount: number
      failedCount?: number
      failed?: Array<{ id: string }>
    }

    expect(body.filledCount).toBe(0)
    expect(body.failedCount).toBe(1)
    expect(body.failed?.[0]).toMatchObject({ id: 'a' })
    errorSpy.mockRestore()
  })
})
