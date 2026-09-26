/**
 * POST /api/admin/task-suggestions/rebuild, the only way to read a
 * transcript twice.
 *
 * The suggester is a one-shot by design (call_transcripts.suggested_at), so
 * the ONLY way a transcript is ever read again is this route. What is pinned
 * here is what makes it safe to press:
 *
 *   IT MERGES BY DEFAULT (CN.1c). Nothing already filed is expired or
 *   rewritten: a pending or snoozed row stays in the inbox, and an applied,
 *   rejected or failed row is a decision nobody gets to overrule from here.
 *   Only `replace` expires anything, and only what is still open.
 *
 *   IT TOUCHES A TRANSCRIPT ONLY WHEN IT WILL BE READ. The read runs inside
 *   the sweep's time budget and asks the route to prepare each call it takes
 *   on; what it does not reach is deferred to the scheduled sweep only if the
 *   sweep will find it (linked to a call, safely inside its window), and is
 *   otherwise left exactly as it was and reported.
 *
 *   IT CLEARS THE MARK LAST, after anything it expires, so a failure leaves
 *   the transcripts read rather than half rebuilt.
 *
 * The database stand-in renders each condition the route writes to SQL with
 * Drizzle's own SQLite dialect and filters the rows below by what it binds,
 * so which transcript a statement touched is asserted, not assumed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'

type Row = Record<string, unknown>

interface Write { table: string; values: Row; params: unknown[] }

const dialect = new SQLiteSyncDialect()

let transcriptRows: Row[] = []
let openRows: Row[] = []
let writes: Write[] = []
let order: string[] = []

const sweep = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  /** How many of the named transcripts the stand-in sweep has time for. */
  fits: Infinity,
  /** Throw once this transcript has been read. */
  throwsAfter: null as string | null,
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
  secondPass: { enabled: true, ran: 1, proposed: 1, failed: [], skipped: [] },
}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async (req: Request) => (
    req.headers.get('x-test-auth') === 'client'
      ? { orgId: 'client-org', userId: 'user_client' }
      : { orgId: 'tahi-org', userId: 'user_liam' }
  ),
  isTahiAdmin: (orgId: string) => orgId === 'tahi-org',
}))

// The sweep is a stand-in that behaves like the real one where the route
// depends on it: oldest first as named, the budget cutting the list at
// `sweep.fits`, and `beforeRead` called for each call it takes on. The
// window rule (`sweepWillReach`) and the batch cap are the real ones.
vi.mock('@/lib/task-suggester', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/task-suggester')>()
  return {
    MAX_SWEEP_BATCH: actual.MAX_SWEEP_BATCH,
    sweepWillReach: actual.sweepWillReach,
    runSuggestionSweep: async (_database: unknown, options: {
      transcriptIds: string[]
      beforeRead?: (id: string) => Promise<void>
    }) => {
      order.push('sweep')
      sweep.calls.push(options as unknown as Record<string, unknown>)
      const ids = options.transcriptIds
      const taken = ids.slice(0, sweep.fits)
      for (const id of taken) {
        await options.beforeRead?.(id)
        order.push(`read:${id}`)
        if (sweep.throwsAfter === id) throw new Error('D1_ERROR: too many SQL variables')
      }
      const deferredIds = ids.slice(taken.length)
      return { ...SUMMARY, looked: taken.length, deferred: deferredIds.length, deferredIds }
    },
  }
})

const render = (cond: unknown) => dialect.sqlToQuery(cond as SQL)
const tableName = (table: unknown) => (table === schema.callTranscripts ? 'call_transcripts' : 'task_suggestions')

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: async (cond: unknown) => {
          const { sql, params } = render(cond)
          if (tableName(table) === 'call_transcripts') {
            // Either every transcript read so far (`all`), or the named ones.
            return sql.includes('"suggested_at" is not null')
              ? transcriptRows.filter(row => row.suggestedAt != null)
              : transcriptRows.filter(row => params.includes(row.id))
          }
          // The open rows of the transcripts in the IN clause.
          return openRows.filter(row => params.includes(row.transcriptId) && params.includes(row.status))
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: async (where: unknown) => {
          order.push(tableName(table))
          writes.push({ table: tableName(table), values, params: render(where).params })
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

const DAY = 86_400_000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString()

/** A transcript the sweep has read, linked to a call, `age` days old. */
function transcript(id: string, age: number, extra: Row = {}): Row {
  return { id, callId: `call-${id}`, receivedAt: daysAgo(age), suggestedAt: daysAgo(0), ...extra }
}

const suggestionWrites = () => writes.filter(w => w.table === 'task_suggestions')
const clearedIds = () => writes.filter(w => w.table === 'call_transcripts').flatMap(w => w.params)

beforeEach(() => {
  transcriptRows = [transcript('tr1', 2), transcript('tr2', 1)]
  openRows = [
    { id: 's1', transcriptId: 'tr1', status: 'pending' },
    { id: 's2', transcriptId: 'tr1', status: 'snoozed' },
  ]
  writes = []
  order = []
  sweep.calls = []
  sweep.fits = Infinity
  sweep.throwsAfter = null
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
    transcriptRows = [transcript('tr1', 2, { suggestedAt: null })]
    const res = await POST(req({ all: true }) as never)
    expect(await res.json()).toEqual({ mode: 'union', transcripts: 0, kept: 0, expired: 0, read: null, deferred: 0, skipped: [] })
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
      transcripts: 1,
      kept: 2,
      expired: 0,
      read: { ...SUMMARY, deferred: 0, deferredIds: [] },
      deferred: 0,
      skipped: [],
    })
    expect(clearedIds()).toEqual(['tr1'])
    expect(writes.find(w => w.table === 'call_transcripts')?.values.suggestedAt).toBeNull()
  })

  it('never writes a status, so no row, open or decided, changes state', async () => {
    await POST(req({ transcriptIds: ['tr1'] }) as never)
    // The one write to the table is the retirement of keys on rows an earlier
    // rebuild already expired, and it sets the key and nothing else.
    expect(suggestionWrites()).toHaveLength(1)
    expect(Object.keys(suggestionWrites()[0].values)).toEqual(['dedupeKey'])
  })

  it('prepares a transcript only once the read takes it on, clearing the mark just before the read', async () => {
    await POST(req({ transcriptIds: ['tr1'] }) as never)
    expect(order).toEqual(['sweep', 'task_suggestions', 'call_transcripts', 'read:tr1'])
  })

  it('reads the named transcripts oldest first, twice each by default, inside the budget from the request start', async () => {
    transcriptRows = [transcript('new', 1), transcript('old', 9), transcript('mid', 4)]
    await POST(req({ transcriptIds: ['new', 'old', 'mid'] }) as never)
    expect(sweep.calls).toHaveLength(1)
    expect(sweep.calls[0]).toMatchObject({ transcriptIds: ['old', 'mid', 'new'], batch: 3, secondPass: true })
    expect(typeof sweep.calls[0].startedAt).toBe('number')
    expect(typeof sweep.calls[0].beforeRead).toBe('function')
  })

  it('reads each once when the caller switches the second read off', async () => {
    await POST(req({ transcriptIds: ['tr1'], secondPass: false }) as never)
    expect(sweep.calls[0]).toMatchObject({ secondPass: false })
  })

  it('only prepares and clears the marks when asked not to read now', async () => {
    const res = await POST(req({ transcriptIds: ['tr1'], readNow: false }) as never)
    expect(await res.json()).toEqual({ mode: 'union', transcripts: 1, kept: 2, expired: 0, read: null, deferred: 1, skipped: [] })
    expect(sweep.calls).toHaveLength(0)
    expect(writes.map(w => w.table)).toEqual(['task_suggestions', 'call_transcripts'])
  })

  it('counts a transcript named twice once', async () => {
    const res = await POST(req({ transcriptIds: ['tr1', 'tr1', ' '], readNow: false }) as never)
    expect(await res.json()).toMatchObject({ transcripts: 1, kept: 2, deferred: 1 })
  })
})

describe('what the read does not reach', () => {
  it('reads the twenty oldest of all, and defers the rest to the scheduled sweep', async () => {
    // Out of order on purpose: the order the read follows is the route's own.
    const ages = [3, 12, 7, 1, 20, 15, 9, 2, 18, 5, 11, 22, 6, 14, 4, 17, 8, 13, 19, 10, 16, 21, 0.5]
    transcriptRows = ages.map(age => transcript(`age-${age}`, age))
    const byAge = [...ages].sort((a, b) => b - a).map(age => `age-${age}`)

    const res = await POST(req({ all: true }) as never)
    const body = await res.json() as { transcripts: number; deferred: number; skipped: unknown[] }

    expect(sweep.calls[0].transcriptIds).toEqual(byAge.slice(0, 20))
    expect(body).toMatchObject({ transcripts: 23, deferred: 3, skipped: [] })
    // The three newest were not read here, so they are cleared for the sweep.
    expect(clearedIds().slice(-3)).toEqual(byAge.slice(20))
  })

  it('defers the calls the budget had no time for, preparing and clearing only those', async () => {
    transcriptRows = [transcript('a', 3), transcript('b', 2), transcript('c', 1)]
    sweep.fits = 1

    const res = await POST(req({ transcriptIds: ['a', 'b', 'c'] }) as never)
    const body = await res.json() as Record<string, unknown>

    expect(order).toEqual(['sweep', 'task_suggestions', 'call_transcripts', 'read:a', 'task_suggestions', 'call_transcripts'])
    expect(body).toMatchObject({ transcripts: 3, deferred: 2, skipped: [] })
    expect(clearedIds()).toEqual(['a', 'b', 'c'])
  })

  it('leaves a call the sweep would never reach exactly as it was, and says so', async () => {
    // Forty days: outside the sweep's window. Twenty nine: inside it today,
    // but not for as long as a queue of deferred calls can take to drain.
    transcriptRows = [transcript('oldest', 45), transcript('old', 40), transcript('edge', 29), transcript('fresh', 2)]
    openRows = [{ id: 's9', transcriptId: 'old', status: 'pending' }]
    sweep.fits = 1

    const res = await POST(req({ all: true, replace: true }) as never)
    const body = await res.json() as Record<string, unknown>

    expect(body).toMatchObject({
      transcripts: 2,
      deferred: 1,
      expired: 0,
      skipped: [
        { transcriptId: 'old', reason: 'too_old_to_defer' },
        { transcriptId: 'edge', reason: 'too_old_to_defer' },
      ],
    })
    // Read inline: the oldest. Deferred: the fresh one. No statement named
    // either of the other two, or the row still open on one of them.
    expect(clearedIds()).toEqual(['oldest', 'fresh'])
    const named = writes.flatMap(w => w.params)
    for (const untouched of ['old', 'edge', 's9']) expect(named).not.toContain(untouched)
  })

  it('never clears a transcript with no linked call, which nothing would ever read', async () => {
    transcriptRows = [transcript('tr1', 2), transcript('loose', 3, { callId: null })]
    const res = await POST(req({ all: true }) as never)
    const body = await res.json() as Record<string, unknown>

    expect(body).toMatchObject({ transcripts: 1, skipped: [{ transcriptId: 'loose', reason: 'unlinked' }] })
    expect(sweep.calls[0].transcriptIds).toEqual(['tr1'])
    expect(clearedIds()).not.toContain('loose')
  })

  it('reports a named id that is not a transcript and touches nothing for it', async () => {
    const res = await POST(req({ transcriptIds: ['tr1', 'ghost'] }) as never)
    expect(await res.json()).toMatchObject({ transcripts: 1, skipped: [{ transcriptId: 'ghost', reason: 'not_found' }] })
    expect(sweep.calls[0].transcriptIds).toEqual(['tr1'])
  })

  it('reports a read that failed, and defers what it never reached', async () => {
    transcriptRows = [transcript('a', 3), transcript('b', 2)]
    sweep.throwsAfter = 'a'

    const res = await POST(req({ transcriptIds: ['a', 'b'] }) as never)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.read).toBeNull()
    expect(body.readError).toContain('too many SQL variables')
    expect(body).toMatchObject({ transcripts: 2, deferred: 1 })
    // `a` was prepared before the read that threw; `b` is prepared once, now.
    expect(clearedIds()).toEqual(['a', 'b'])
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
    expect(expiring!.params).toEqual(['s1', 's2'])

    // Expire, retire the keys of earlier expired rows, clear the mark, read.
    expect(order).toEqual(['sweep', 'task_suggestions', 'task_suggestions', 'call_transcripts', 'read:tr1'])
  })

  it('takes ?replace=1 from the query as well, for a person with curl', async () => {
    const res = await POST(req({ transcriptIds: ['tr1'] }, { query: '?replace=1' }) as never)
    expect(await res.json()).toMatchObject({ mode: 'replace', expired: 2 })
  })

  it('writes no expiry when nothing is open, but still clears the mark', async () => {
    openRows = []
    const res = await POST(req({ transcriptIds: ['tr1'], replace: true, readNow: false }) as never)
    expect(await res.json()).toEqual({ mode: 'replace', transcripts: 1, kept: 0, expired: 0, read: null, deferred: 1, skipped: [] })
    expect(writes.map(w => w.table)).toEqual(['task_suggestions', 'call_transcripts'])
  })

  it('reads the switch by one rule, in the body and in the query alike', async () => {
    const yes: unknown[] = [true, 1, '1', 'true', 'yes', ' YES ', 'True']
    const no: unknown[] = [false, 0, 2, '0', 'no', 'maybe', '', null]
    for (const value of yes) {
      const fromBody = await POST(req({ transcriptIds: ['tr1'], replace: value, readNow: false }) as never)
      expect(((await fromBody.json()) as { mode: string }).mode, `body ${JSON.stringify(value)}`).toBe('replace')
      if (typeof value === 'string') {
        const fromQuery = await POST(req({ transcriptIds: ['tr1'], readNow: false }, { query: `?replace=${encodeURIComponent(value)}` }) as never)
        expect(((await fromQuery.json()) as { mode: string }).mode, `query ${value}`).toBe('replace')
      }
    }
    for (const value of no) {
      const fromBody = await POST(req({ transcriptIds: ['tr1'], replace: value, readNow: false }) as never)
      expect(((await fromBody.json()) as { mode: string }).mode, `body ${JSON.stringify(value)}`).toBe('union')
      if (typeof value === 'string') {
        const fromQuery = await POST(req({ transcriptIds: ['tr1'], readNow: false }, { query: `?replace=${encodeURIComponent(value)}` }) as never)
        expect(((await fromQuery.json()) as { mode: string }).mode, `query ${value}`).toBe('union')
      }
    }
  })

  it('expires in chunks the bound parameter cap allows, however many rows are open', async () => {
    openRows = Array.from({ length: 170 }, (_, i) => ({ id: `s${i}`, transcriptId: 'tr1', status: 'pending' }))
    const res = await POST(req({ transcriptIds: ['tr1'], replace: true, readNow: false }) as never)
    expect(await res.json()).toMatchObject({ expired: 170 })

    const expiries = suggestionWrites().filter(w => w.values.status === 'expired')
    expect(expiries.map(w => w.params.length)).toEqual([80, 80, 10])
    // Every id once, and the six values the statement binds beside them still
    // leave it under D1's hundred.
    expect(new Set(expiries.flatMap(w => w.params)).size).toBe(170)
    for (const w of expiries) expect(w.params.length + Object.keys(w.values).length).toBeLessThanOrEqual(100)
  })
})
