/**
 * POST /api/admin/task-suggestions/rebuild, the only way to read a
 * transcript twice.
 *
 * The suggester is a one-shot by design (call_transcripts.suggested_at), so
 * the ONLY way a transcript is ever read again is this route clearing that
 * mark. What is pinned here is what makes it safe to press:
 *
 *   IT MERGES BY DEFAULT (CN.1c). Nothing already filed is expired or
 *   rewritten: a pending or snoozed row stays in the inbox, and an applied,
 *   rejected or failed row is a decision nobody gets to overrule from here.
 *   Only `replace` expires anything, and only what is still open.
 *
 *   IT CLEARS THE MARK LAST, after anything it expires, so a failure leaves
 *   the transcripts read rather than half rebuilt.
 *
 *   IT READS NOW, twice per call unless told otherwise, and reports the read;
 *   a read that fails still leaves the marks cleared for the scheduled sweep.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

interface Write { table: string; values: Row }

let transcriptRows: Row[] = []
let openRows: Row[] = []
let writes: Write[] = []
let order: string[] = []

const sweep = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  throws: false,
}))

const SUMMARY = {
  looked: 1,
  eligible: 1,
  skipped: [],
  inserted: 2,
  duplicates: 3,
  dropped: 0,
  resurfaced: 0,
  costCents: 9,
  repaired: 0,
  dropReasons: {},
  secondPass: { enabled: true, ran: 1, proposed: 1, failed: [] },
}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async (req: Request) => (
    req.headers.get('x-test-auth') === 'client'
      ? { orgId: 'client-org', userId: 'user_client' }
      : { orgId: 'tahi-org', userId: 'user_liam' }
  ),
  isTahiAdmin: (orgId: string) => orgId === 'tahi-org',
}))

vi.mock('@/lib/task-suggester', () => ({
  MAX_SWEEP_BATCH: 20,
  runSuggestionSweep: async (_database: unknown, options: Record<string, unknown>) => {
    order.push('sweep')
    sweep.calls.push(options)
    if (sweep.throws) throw new Error('D1_ERROR: too many SQL variables')
    return SUMMARY
  },
}))

vi.mock('@/db/d1', () => ({
  schema: {
    taskSuggestions: {
      _table: 'task_suggestions',
      id: 'id',
      transcriptId: 'transcript_id',
      status: 'status',
      snoozeUntil: 'snooze_until',
      decidedById: 'decided_by_id',
      decidedVia: 'decided_via',
      decidedAt: 'decided_at',
      updatedAt: 'updated_at',
      dedupeKey: 'dedupe_key',
    },
    callTranscripts: { _table: 'call_transcripts', id: 'id', suggestedAt: 'suggested_at', receivedAt: 'received_at' },
  },
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { and: stub, asc: stub, eq: stub, inArray: stub, isNotNull: stub, notLike: stub, sql: stub }
})

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => ({
      from: (table: { _table?: string }) => {
        const rows = table?._table === 'call_transcripts' ? transcriptRows : openRows
        const chain = Promise.resolve(rows) as Promise<Row[]> & { where: () => unknown; orderBy: () => unknown }
        chain.where = () => chain
        chain.orderBy = () => chain
        return chain
      },
    }),
    update: (table: { _table?: string }) => ({
      set: (values: Row) => ({
        where: async () => {
          order.push(table?._table ?? '')
          writes.push({ table: table?._table ?? '', values })
        },
      }),
    }),
  }),
}))

const { POST } = await import('../rebuild/route')

function req(body: unknown, options: { auth?: 'client'; query?: string } = {}): Request {
  return new Request(`http://localhost/api/admin/task-suggestions/rebuild${options.query ?? ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.auth ? { 'x-test-auth': options.auth } : {}) },
    body: JSON.stringify(body),
  })
}

const suggestionWrites = () => writes.filter(w => w.table === 'task_suggestions')

beforeEach(() => {
  transcriptRows = [{ id: 'tr1' }, { id: 'tr2' }]
  openRows = [{ id: 's1' }, { id: 's2' }]
  writes = []
  order = []
  sweep.calls = []
  sweep.throws = false
})

describe('POST /api/admin/task-suggestions/rebuild', () => {
  it('403s a caller outside the Tahi admin org', async () => {
    const res = await POST(req({ all: true }, { auth: 'client' }) as never)
    expect(res.status).toBe(403)
    expect(writes).toHaveLength(0)
    expect(sweep.calls).toHaveLength(0)
  })

  it('400s a call that names neither transcripts nor all', async () => {
    const res = await POST(req({}) as never)
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  it('answers zero rather than writing when no transcript has been read yet', async () => {
    transcriptRows = []
    const res = await POST(req({ all: true }) as never)
    expect(await res.json()).toEqual({ mode: 'union', expired: 0, kept: 0, transcripts: 0 })
    expect(writes).toHaveLength(0)
    expect(sweep.calls).toHaveLength(0)
  })
})

describe('the default: a re-read adds, it never replaces (CN.1c)', () => {
  it('keeps every open row, clears the mark, and reads the transcript again now', async () => {
    const res = await POST(req({ transcriptIds: ['tr1'] }) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'union',
      expired: 0,
      kept: 2,
      transcripts: 1,
      read: SUMMARY,
      deferred: 0,
    })

    const cleared = writes.find(w => w.table === 'call_transcripts')
    expect(cleared?.values.suggestedAt).toBeNull()
  })

  it('never writes a status, so no row, open or decided, changes state', async () => {
    await POST(req({ transcriptIds: ['tr1'] }) as never)
    // The one write to the table is the retirement of keys on rows an earlier
    // rebuild already expired, and it sets the key and nothing else.
    expect(suggestionWrites()).toHaveLength(1)
    expect(Object.keys(suggestionWrites()[0].values)).toEqual(['dedupeKey'])
  })

  it('clears the mark before it reads, and reads after everything else', async () => {
    await POST(req({ transcriptIds: ['tr1'] }) as never)
    expect(order).toEqual(['task_suggestions', 'call_transcripts', 'sweep'])
  })

  it('reads exactly the cleared transcripts, twice each, by default', async () => {
    await POST(req({ transcriptIds: ['tr1', 'tr2'] }) as never)
    expect(sweep.calls).toEqual([{ transcriptIds: ['tr1', 'tr2'], batch: 2, secondPass: true }])
  })

  it('reads each once when the caller switches the second read off', async () => {
    await POST(req({ transcriptIds: ['tr1'], secondPass: false }) as never)
    expect(sweep.calls[0]).toMatchObject({ secondPass: false })
  })

  it('only clears the marks when asked not to read now', async () => {
    const res = await POST(req({ transcriptIds: ['tr1'], readNow: false }) as never)
    expect(await res.json()).toEqual({ mode: 'union', expired: 0, kept: 2, transcripts: 1 })
    expect(sweep.calls).toHaveLength(0)
    expect(writes.map(w => w.table)).toEqual(['task_suggestions', 'call_transcripts'])
  })

  it('reads at most twenty inline, oldest first, and leaves the rest to the scheduled sweep', async () => {
    transcriptRows = Array.from({ length: 23 }, (_, i) => ({ id: `tr${i}` }))
    const res = await POST(req({ all: true }) as never)
    const body = await res.json() as { transcripts: number; deferred: number }

    expect(body.transcripts).toBe(23)
    expect(body.deferred).toBe(3)
    expect(sweep.calls[0].transcriptIds).toEqual(transcriptRows.slice(0, 20).map(row => row.id))
  })

  it('reports a read that failed without undoing the rebuild', async () => {
    sweep.throws = true
    const res = await POST(req({ transcriptIds: ['tr1'] }) as never)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.read).toBeNull()
    expect(body.readError).toContain('too many SQL variables')
    expect(writes.find(w => w.table === 'call_transcripts')?.values.suggestedAt).toBeNull()
  })

  it('counts a transcript named twice once', async () => {
    const res = await POST(req({ transcriptIds: ['tr1', 'tr1', ' '], readNow: false }) as never)
    expect(await res.json()).toEqual({ mode: 'union', expired: 0, kept: 2, transcripts: 1 })
  })
})

describe('replace: the escape hatch that still expires', () => {
  it('expires the open rows, then clears the mark, then reads', async () => {
    const res = await POST(req({ transcriptIds: ['tr1'], replace: true }) as never)
    expect(await res.json()).toMatchObject({ mode: 'replace', expired: 2, kept: 0, transcripts: 1 })

    const expiring = suggestionWrites().find(w => w.values.status === 'expired')
    // Expired, never rejected: nobody looked at these.
    expect(expiring?.values.decidedById).toBe('user_liam')
    expect(expiring?.values.decidedVia).toBe('dashboard')
    // A snoozed row coming back as expired must not keep its alarm.
    expect(expiring?.values.snoozeUntil).toBeNull()
    // The key retires with the row, so the re-read can file the item again.
    expect(expiring?.values.dedupeKey).toBeTruthy()

    // Expire, retire the keys of earlier expired rows, clear the mark, read.
    expect(order).toEqual(['task_suggestions', 'task_suggestions', 'call_transcripts', 'sweep'])
  })

  it('takes ?replace=1 from the query as well, for a person with curl', async () => {
    const res = await POST(req({ transcriptIds: ['tr1'] }, { query: '?replace=1' }) as never)
    expect(await res.json()).toMatchObject({ mode: 'replace', expired: 2 })
  })

  it('writes no expiry when nothing is open, but still clears the mark', async () => {
    openRows = []
    const res = await POST(req({ transcriptIds: ['tr1'], replace: true, readNow: false }) as never)
    expect(await res.json()).toEqual({ mode: 'replace', expired: 0, kept: 0, transcripts: 1 })
    expect(writes.map(w => w.table)).toEqual(['task_suggestions', 'call_transcripts'])
  })

  it('treats anything but a literal true as no', async () => {
    const res = await POST(req({ transcriptIds: ['tr1'], replace: 'yes', readNow: false }) as never)
    expect(await res.json()).toMatchObject({ mode: 'union', expired: 0 })
    expect(suggestionWrites().some(w => w.values.status === 'expired')).toBe(false)
  })
})
