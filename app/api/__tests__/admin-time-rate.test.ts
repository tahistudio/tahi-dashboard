/**
 * The hourly rate on a manual time entry.
 *
 * The gap this closes: /time has always shown a "Rate" field in its Log time
 * slide-over, and POST /api/admin/time never read `hourlyRate` off the body.
 * Every rate anyone typed on that page was posted and thrown away, while the
 * other manual-entry URL (POST /api/admin/time-entries) stored the same field
 * happily. Both now write through lib/time-entries.ts, which is also where the
 * fallback to the client's `default_hourly_rate` lives.
 *
 * The rule under test, in full:
 *   1. a rate on the body wins (including an explicit 0, which is a decision)
 *   2. else the client's default_hourly_rate, when set and above zero
 *   3. else null. Never a silent 0, because a zero rate bills nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  rows: Record<string, Row[]>
  inserts: Array<{ table: string | undefined; values: Row }>
} = { rows: {}, inserts: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ orgId: 'org_tahi', userId: 'clerk_admin', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

// The GET half of /api/admin/time pulls the scoping tree in. POST never calls
// it, and stubbing it keeps this file about the rate.
vi.mock('@/lib/access-scope', () => ({
  scopedOrgIds: vi.fn().mockResolvedValue({ kind: 'all' }),
}))

vi.mock('@/lib/internal-org', () => ({
  INTERNAL_ORG_ID: 'org_tahi_internal',
  ensureInternalOrg: vi.fn().mockResolvedValue('org_tahi_internal'),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: { _table: 'requests', id: 1, orgId: 1, title: 1 },
    tasks: { _table: 'tasks', id: 1, orgId: 1, requestId: 1, type: 1 },
    timeEntries: {
      _table: 'timeEntries',
      id: 1, orgId: 1, requestId: 1, taskId: 1, teamMemberId: 1,
      hours: 1, hourlyRate: 1, billable: 1, notes: 1, date: 1,
      startedAt: 1, endedAt: 1, source: 1, createdAt: 1, updatedAt: 1,
    },
    teamMembers: { _table: 'teamMembers', id: 1, name: 1, clerkUserId: 1, weeklyCapacityHours: 1 },
    organisations: { _table: 'organisations', id: 1, name: 1, defaultHourlyRate: 1 },
  },
}))

vi.mock('drizzle-orm', () => {
  const tag = () => ({ op: 'sql' })
  return {
    and: (...a: unknown[]) => ({ op: 'and', a }),
    eq: (...a: unknown[]) => ({ op: 'eq', a }),
    gte: (...a: unknown[]) => ({ op: 'gte', a }),
    lte: (...a: unknown[]) => ({ op: 'lte', a }),
    desc: (a: unknown) => ({ op: 'desc', a }),
    inArray: (...a: unknown[]) => ({ op: 'inArray', a }),
    sql: Object.assign(tag, { raw: (s: string) => ({ op: 'raw', s }) }),
  }
})

function makeHandle() {
  function chainFor(name: string | undefined) {
    const rows = state.rows[name ?? ''] ?? []
    const chain = Promise.resolve(rows) as Promise<Row[]> & Record<string, () => unknown>
    for (const method of ['where', 'limit', 'leftJoin', 'orderBy', 'offset']) {
      chain[method] = () => chain
    }
    return chain
  }
  return {
    select: () => ({ from: (t: { _table?: string } | undefined) => chainFor(t?._table) }),
    insert: (t: { _table?: string } | undefined) => ({
      values: (values: Row) => {
        state.inserts.push({ table: t?._table, values })
        return Promise.resolve(undefined)
      },
    }),
  }
}

vi.mock('@/lib/db', () => ({
  db: vi.fn(async () => makeHandle()),
}))

import { NextRequest } from 'next/server'
import { POST as timePost } from '@/app/api/admin/time/route'
import { POST as timeEntriesPost } from '@/app/api/admin/time-entries/route'
import {
  createTimeEntry,
  deriveHoursAndDate,
  isTimeEntryFailure,
  resolveHourlyRate,
  validateTimeEntryDraft,
} from '@/lib/time-entries'

function post(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function loggedEntry(): Row {
  const insert = state.inserts.find(i => i.table === 'timeEntries')
  expect(insert).toBeDefined()
  return insert!.values
}

/** A valid POST /api/admin/time body, minus whatever a case is varying. */
const BASE = {
  orgId: 'org_client_a',
  teamMemberId: 'tm_1',
  hours: 2,
  date: '2026-09-07',
}

beforeEach(() => {
  state.rows = {}
  state.inserts = []
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
})

// ---------------------------------------------------------------------------
// The shared module
// ---------------------------------------------------------------------------
describe('lib/time-entries resolveHourlyRate', () => {
  const drizzle = () => makeHandle() as never

  it('takes the supplied rate over the client default', async () => {
    state.rows.organisations = [{ defaultHourlyRate: 180 }]
    expect(await resolveHourlyRate(drizzle(), 'org_client_a', 150)).toBe(150)
  })

  it('falls back to the client default when none is supplied', async () => {
    state.rows.organisations = [{ defaultHourlyRate: 180 }]
    expect(await resolveHourlyRate(drizzle(), 'org_client_a', undefined)).toBe(180)
    expect(await resolveHourlyRate(drizzle(), 'org_client_a', null)).toBe(180)
  })

  it('returns null when neither a body rate nor a client default exists', async () => {
    state.rows.organisations = [{ defaultHourlyRate: null }]
    expect(await resolveHourlyRate(drizzle(), 'org_client_a', undefined)).toBeNull()
    state.rows.organisations = []
    expect(await resolveHourlyRate(drizzle(), 'org_client_a', undefined)).toBeNull()
  })

  it('never turns a zero client default into a zero rate', async () => {
    // A client whose default is 0 has no rate, not a free one. Storing 0 would
    // put a line worth nothing on an invoice.
    state.rows.organisations = [{ defaultHourlyRate: 0 }]
    expect(await resolveHourlyRate(drizzle(), 'org_client_a', undefined)).toBeNull()
  })

  it('keeps an explicitly supplied zero, which is a decision not a default', async () => {
    state.rows.organisations = [{ defaultHourlyRate: 180 }]
    expect(await resolveHourlyRate(drizzle(), 'org_client_a', 0)).toBe(0)
  })
})

describe('lib/time-entries validateTimeEntryDraft', () => {
  const valid = { orgId: 'o', teamMemberId: 'm', hours: 1, date: '2026-09-07' }

  it('passes a complete draft', () => {
    expect(validateTimeEntryDraft(valid)).toBeNull()
  })

  it('names the missing field rather than failing generically', () => {
    expect(validateTimeEntryDraft({ ...valid, orgId: undefined })?.error).toBe('orgId is required')
    expect(validateTimeEntryDraft({ ...valid, teamMemberId: undefined })?.error).toBe('teamMemberId is required')
    expect(validateTimeEntryDraft({ ...valid, hours: 0 })?.error).toBe('hours must be a positive number')
    expect(validateTimeEntryDraft({ ...valid, date: undefined })?.error).toBe('date is required')
  })

  it('rejects a negative rate and lets an absent one through', () => {
    expect(validateTimeEntryDraft({ ...valid, hourlyRate: -1 })?.status).toBe(400)
    expect(validateTimeEntryDraft({ ...valid, hourlyRate: Number.NaN })?.status).toBe(400)
    expect(validateTimeEntryDraft({ ...valid, hourlyRate: null })).toBeNull()
    expect(validateTimeEntryDraft({ ...valid, hourlyRate: 0 })).toBeNull()
  })
})

describe('lib/time-entries deriveHoursAndDate', () => {
  it('derives hours and date from a range', () => {
    const out = deriveHoursAndDate({ startedAt: '2026-09-07T09:00:00Z', endedAt: '2026-09-07T12:30:00Z' })
    expect(isTimeEntryFailure(out)).toBe(false)
    expect(out).toMatchObject({ hours: 3.5, date: '2026-09-07' })
  })

  it('trusts explicit hours over the range', () => {
    const out = deriveHoursAndDate({ hours: 1, startedAt: '2026-09-07T09:00:00Z', endedAt: '2026-09-07T12:30:00Z' })
    expect(out).toMatchObject({ hours: 1 })
  })

  it('refuses a backwards range', () => {
    const out = deriveHoursAndDate({ startedAt: '2026-09-07T12:00:00Z', endedAt: '2026-09-07T09:00:00Z' })
    expect(isTimeEntryFailure(out)).toBe(true)
  })
})

describe('lib/time-entries createTimeEntry', () => {
  it('stores the resolved rate on the row, not a lookup for later', async () => {
    state.rows.organisations = [{ defaultHourlyRate: 180 }]
    const result = await createTimeEntry(makeHandle() as never, {
      orgId: 'org_client_a', teamMemberId: 'tm_1', hours: 2, date: '2026-09-07',
    })
    expect(result.ok).toBe(true)
    expect(loggedEntry().hourlyRate).toBe(180)
  })

  it('refuses an invalid draft instead of writing a partial row', async () => {
    const result = await createTimeEntry(makeHandle() as never, {
      orgId: null, teamMemberId: 'tm_1', hours: 2, date: '2026-09-07',
    })
    expect(result.ok).toBe(false)
    expect(state.inserts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/time  (the route that used to drop the rate)
// ---------------------------------------------------------------------------
describe('POST /api/admin/time', () => {
  it('persists the rate typed into the Log time form', async () => {
    state.rows.organisations = [{ defaultHourlyRate: 180 }]
    const res = await timePost(post('/api/admin/time', { ...BASE, hourlyRate: 150 }))
    expect(res.status).toBe(200)
    expect(loggedEntry().hourlyRate).toBe(150)
  })

  it('falls back to the client default rate when the field is left blank', async () => {
    state.rows.organisations = [{ defaultHourlyRate: 180 }]
    const res = await timePost(post('/api/admin/time', BASE))
    expect(res.status).toBe(200)
    expect(loggedEntry().hourlyRate).toBe(180)
  })

  it('stores no rate rather than zero when the client has no default either', async () => {
    state.rows.organisations = [{ defaultHourlyRate: null }]
    const res = await timePost(post('/api/admin/time', BASE))
    expect(res.status).toBe(200)
    expect(loggedEntry().hourlyRate).toBeNull()
  })

  it('still returns { id } and writes every other field it always wrote', async () => {
    state.rows.organisations = [{ defaultHourlyRate: null }]
    const res = await timePost(post('/api/admin/time', {
      ...BASE, requestId: 'req_1', notes: 'Homepage build', billable: false,
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { id?: string }
    expect(typeof body.id).toBe('string')
    const entry = loggedEntry()
    expect(entry).toMatchObject({
      id: body.id,
      orgId: 'org_client_a',
      requestId: 'req_1',
      teamMemberId: 'tm_1',
      hours: 2,
      date: '2026-09-07',
      notes: 'Homepage build',
      billable: false,
      source: 'manual',
    })
    expect(typeof entry.createdAt).toBe('string')
  })

  it('defaults billable to true, as it always has', async () => {
    const res = await timePost(post('/api/admin/time', BASE))
    expect(res.status).toBe(200)
    expect(loggedEntry().billable).toBe(true)
  })

  it('keeps naming the missing field, before it touches the database', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...BASE, orgId: undefined }, 'orgId is required'],
      [{ ...BASE, teamMemberId: undefined }, 'teamMemberId is required'],
      [{ ...BASE, hours: 0 }, 'hours must be a positive number'],
      [{ ...BASE, date: undefined }, 'date is required'],
    ]
    for (const [body, message] of cases) {
      state.inserts = []
      const res = await timePost(post('/api/admin/time', body))
      expect(res.status).toBe(400)
      expect((await res.json() as { error?: string }).error).toBe(message)
      expect(state.inserts).toHaveLength(0)
    }
  })

  it('refuses a negative rate instead of storing it', async () => {
    const res = await timePost(post('/api/admin/time', { ...BASE, hourlyRate: -5 }))
    expect(res.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/time-entries  (unchanged behaviour, now sharing the writer)
// ---------------------------------------------------------------------------
describe('POST /api/admin/time-entries', () => {
  it('still persists a rate handed to it on the body', async () => {
    state.rows.requests = [{ orgId: 'org_client_a' }]
    state.rows.organisations = [{ defaultHourlyRate: 180 }]
    const res = await timeEntriesPost(post('/api/admin/time-entries', { requestId: 'req_1', hours: 1.5, hourlyRate: 210 }))
    expect(res.status).toBe(201)
    expect(loggedEntry().hourlyRate).toBe(210)
  })

  it('now falls back to the client default instead of storing nothing', async () => {
    state.rows.requests = [{ orgId: 'org_client_a' }]
    state.rows.organisations = [{ defaultHourlyRate: 180 }]
    const res = await timeEntriesPost(post('/api/admin/time-entries', { requestId: 'req_1', hours: 1.5 }))
    expect(res.status).toBe(201)
    expect(loggedEntry().hourlyRate).toBe(180)
  })

  it('stores no rate when neither the body nor the client names one', async () => {
    state.rows.tasks = [{ orgId: null, requestId: null, type: 'tahi_internal' }]
    state.rows.organisations = []
    const res = await timeEntriesPost(post('/api/admin/time-entries', { taskId: 'task_internal', hours: 0.5 }))
    expect(res.status).toBe(201)
    expect(loggedEntry().hourlyRate).toBeNull()
    // The studio org resolution is untouched by the unification.
    expect(loggedEntry().orgId).toBe('org_tahi_internal')
  })

  it('keeps deriving hours from a range and refusing a backwards one', async () => {
    state.rows.requests = [{ orgId: 'org_client_a' }]
    const ok = await timeEntriesPost(post('/api/admin/time-entries', {
      requestId: 'req_1', startedAt: '2026-09-07T09:00:00Z', endedAt: '2026-09-07T10:15:00Z',
    }))
    expect(ok.status).toBe(201)
    expect(await ok.json()).toMatchObject({ hours: 1.25, date: '2026-09-07' })

    state.inserts = []
    const bad = await timeEntriesPost(post('/api/admin/time-entries', {
      requestId: 'req_1', startedAt: '2026-09-07T10:00:00Z', endedAt: '2026-09-07T09:00:00Z',
    }))
    expect(bad.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })
})
