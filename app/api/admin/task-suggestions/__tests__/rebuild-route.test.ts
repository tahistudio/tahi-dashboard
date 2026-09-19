/**
 * POST /api/admin/task-suggestions/rebuild, the CN.1b cutover door.
 *
 * The suggester is a one-shot by design (call_transcripts.suggested_at), so
 * the ONLY way a transcript is ever read twice is this route clearing that
 * mark. What is pinned here is the pair of things that makes it safe to press:
 *
 *   IT EXPIRES RATHER THAN DELETES, and only what is still open. An applied
 *   or rejected row is a decision a founder made; re-proposing it would be
 *   the inbox arguing with them.
 *
 *   IT CLEARS THE MARK AFTER, not before, so a failure leaves the transcripts
 *   read and the old rows pending rather than the same suggestion in the
 *   inbox twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

interface Write { table: string; values: Row }

let transcriptRows: Row[] = []
let openRows: Row[] = []
let writes: Write[] = []
let order: string[] = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async (req: Request) => (
    req.headers.get('x-test-auth') === 'client'
      ? { orgId: 'client-org', userId: 'user_client' }
      : { orgId: 'tahi-org', userId: 'user_liam' }
  ),
  isTahiAdmin: (orgId: string) => orgId === 'tahi-org',
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
    },
    callTranscripts: { _table: 'call_transcripts', id: 'id', suggestedAt: 'suggested_at' },
  },
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { and: stub, inArray: stub, isNotNull: stub }
})

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => ({
      from: (table: { _table?: string }) => {
        const rows = table?._table === 'call_transcripts' ? transcriptRows : openRows
        const chain = Promise.resolve(rows) as Promise<Row[]> & { where: () => unknown }
        chain.where = () => chain
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

function req(body: unknown, auth?: 'client'): Request {
  return new Request('http://localhost/api/admin/task-suggestions/rebuild', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { 'x-test-auth': auth } : {}) },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  transcriptRows = [{ id: 'tr1' }, { id: 'tr2' }]
  openRows = [{ id: 's1' }, { id: 's2' }]
  writes = []
  order = []
})

describe('POST /api/admin/task-suggestions/rebuild', () => {
  it('403s a caller outside the Tahi admin org', async () => {
    const res = await POST(req({ all: true }, 'client') as never)
    expect(res.status).toBe(403)
    expect(writes).toHaveLength(0)
  })

  it('400s a call that names neither transcripts nor all', async () => {
    const res = await POST(req({}) as never)
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  it('expires the open rows and clears the mark on the named transcripts', async () => {
    const res = await POST(req({ transcriptIds: ['tr1'] }) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ expired: 2, transcripts: 1 })

    const expiring = writes.find(w => w.table === 'task_suggestions')
    expect(expiring?.values.status).toBe('expired')
    // Expired, never rejected: nobody looked at these.
    expect(expiring?.values.decidedById).toBe('user_liam')
    expect(expiring?.values.decidedVia).toBe('dashboard')
    // A snoozed row coming back as expired must not keep its alarm.
    expect(expiring?.values.snoozeUntil).toBeNull()

    const cleared = writes.find(w => w.table === 'call_transcripts')
    expect(cleared?.values.suggestedAt).toBeNull()
  })

  it('clears the mark only after the rows are expired', async () => {
    await POST(req({ transcriptIds: ['tr1'] }) as never)
    expect(order).toEqual(['task_suggestions', 'call_transcripts'])
  })

  it('takes every transcript that has been read when all is true', async () => {
    const res = await POST(req({ all: true }) as never)
    expect(await res.json()).toEqual({ expired: 2, transcripts: 2 })
  })

  it('writes no suggestion update when nothing is open, but still clears the mark', async () => {
    openRows = []
    const res = await POST(req({ transcriptIds: ['tr1'] }) as never)
    expect(await res.json()).toEqual({ expired: 0, transcripts: 1 })
    expect(writes.map(w => w.table)).toEqual(['call_transcripts'])
  })

  it('answers zero rather than writing when no transcript has been read yet', async () => {
    transcriptRows = []
    const res = await POST(req({ all: true }) as never)
    expect(await res.json()).toEqual({ expired: 0, transcripts: 0 })
    expect(writes).toHaveLength(0)
  })

  it('counts a transcript named twice once', async () => {
    const res = await POST(req({ transcriptIds: ['tr1', 'tr1', ' '] }) as never)
    expect(await res.json()).toEqual({ expired: 2, transcripts: 1 })
  })
})
