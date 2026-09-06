/**
 * Who a time entry belongs to, on the way in and on the way out.
 *
 * The bug this closes: `time_entries.team_member_id` has a foreign key to
 * `team_members.id`, and POST /api/admin/time-entries inserted the CLERK user
 * id it had in its hand. Every entry logged from the time card on a request or
 * task therefore joined to no member row and read as "Unknown" on /time, while
 * the live timer, which resolved the Clerk id first, read correctly. Same
 * hours, two owners, depending on which button was pressed.
 *
 * Both halves are covered here:
 *
 *   write : the Clerk id is resolved to a team_members row, an explicit
 *           teamMemberId is honoured, and a caller who resolves to nobody is
 *           refused rather than written as an orphan.
 *   read  : the shared join reaches the rows already written the old way
 *           through `team_members.clerk_user_id`, so history stops reading
 *           "Unknown" without rewriting a single billing row.
 *
 * The rate half of POST /api/admin/requests/[id]/time-entries lives here too:
 * that URL never accepted an hourly rate, so every entry it wrote carried NULL
 * and fell out of the hourly Xero export even for clients with a default rate.
 *
 * The db mock in this file honours WHERE and JOIN conditions, unlike the
 * table-keyed stub the neighbouring time tests use. It has to: the whole
 * subject is which row a condition matches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
/** One candidate result row: the base row plus whatever joined to it. */
type Ctx = Record<string, Row | null>

const state: {
  rows: Record<string, Row[]>
  inserts: Array<{ table: string | undefined; values: Row }>
} = { rows: {}, inserts: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ orgId: 'org_tahi', userId: 'clerk_liam', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/internal-org', () => ({
  INTERNAL_ORG_ID: 'org_tahi_internal',
  ensureInternalOrg: vi.fn().mockResolvedValue('org_tahi_internal'),
}))

// Columns are their own qualified names, so a mocked condition carries enough
// to be evaluated rather than merely recorded.
vi.mock('@/db/d1', () => ({
  schema: {
    requests: { _table: 'requests', id: 'requests.id', orgId: 'requests.orgId', title: 'requests.title' },
    tasks: { _table: 'tasks', id: 'tasks.id', orgId: 'tasks.orgId', requestId: 'tasks.requestId', type: 'tasks.type' },
    organisations: { _table: 'organisations', id: 'organisations.id', name: 'organisations.name', defaultHourlyRate: 'organisations.defaultHourlyRate' },
    teamMembers: {
      _table: 'teamMembers',
      id: 'teamMembers.id',
      name: 'teamMembers.name',
      role: 'teamMembers.role',
      clerkUserId: 'teamMembers.clerkUserId',
    },
    timeEntries: {
      _table: 'timeEntries',
      id: 'timeEntries.id',
      orgId: 'timeEntries.orgId',
      requestId: 'timeEntries.requestId',
      taskId: 'timeEntries.taskId',
      teamMemberId: 'timeEntries.teamMemberId',
      hours: 'timeEntries.hours',
      hourlyRate: 'timeEntries.hourlyRate',
      billable: 'timeEntries.billable',
      notes: 'timeEntries.notes',
      date: 'timeEntries.date',
      source: 'timeEntries.source',
      createdAt: 'timeEntries.createdAt',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  or: (...a: unknown[]) => ({ op: 'or', a }),
  eq: (l: unknown, r: unknown) => ({ op: 'eq', l, r }),
  desc: (a: unknown) => ({ op: 'desc', a }),
}))

/**
 * A qualified column name reads from the joined row; anything else is a
 * literal. A column on a row that did not join is null, the way SQL has it,
 * rather than undefined, which JSON.stringify would drop from the response.
 */
function value(ref: unknown, ctx: Ctx): unknown {
  if (typeof ref === 'string' && ref.includes('.')) {
    const [table, column] = ref.split('.')
    const row = ctx[table]
    if (!row) return null
    return column in row ? row[column] : null
  }
  return ref
}

function matches(cond: unknown, ctx: Ctx): boolean {
  if (!cond || typeof cond !== 'object') return true
  const c = cond as { op?: string; a?: unknown[]; l?: unknown; r?: unknown }
  if (c.op === 'and') return (c.a ?? []).every(part => matches(part, ctx))
  if (c.op === 'or') return (c.a ?? []).some(part => matches(part, ctx))
  if (c.op === 'eq') {
    const left = value(c.l, ctx)
    if (left === undefined || left === null) return false
    return left === value(c.r, ctx)
  }
  return true
}

vi.mock('@/lib/db', () => {
  function from(projection: Record<string, unknown> | undefined, base: { _table?: string } | undefined) {
    const baseTable = base?._table ?? ''
    const joins: Array<{ table: string; on: unknown }> = []
    const wheres: unknown[] = []
    let take: number | null = null

    function run(): Row[] {
      let ctxs: Ctx[] = (state.rows[baseTable] ?? []).map(row => ({ [baseTable]: row }))
      for (const join of joins) {
        ctxs = ctxs.map(ctx => ({
          ...ctx,
          [join.table]: (state.rows[join.table] ?? []).find(row => matches(join.on, { ...ctx, [join.table]: row })) ?? null,
        }))
      }
      ctxs = ctxs.filter(ctx => wheres.every(where => matches(where, ctx)))
      if (take !== null) ctxs = ctxs.slice(0, take)
      return ctxs.map(ctx => {
        if (!projection) return ctx[baseTable] ?? {}
        const out: Row = {}
        for (const [key, ref] of Object.entries(projection)) out[key] = value(ref, ctx)
        return out
      })
    }

    const chain = {
      leftJoin(table: { _table?: string } | undefined, on: unknown) {
        joins.push({ table: table?._table ?? '', on })
        return chain
      },
      where(cond: unknown) { wheres.push(cond); return chain },
      orderBy() { return chain },
      offset() { return chain },
      limit(n: number) { take = n; return chain },
      then<T>(ok: (rows: Row[]) => T, fail?: (err: unknown) => T) {
        return Promise.resolve().then(run).then(ok, fail)
      },
    }
    return chain
  }

  return {
    db: vi.fn(async () => ({
      select: (projection?: Record<string, unknown>) => ({
        from: (table: { _table?: string } | undefined) => from(projection, table),
      }),
      insert: (table: { _table?: string } | undefined) => ({
        values: (values: Row) => {
          state.inserts.push({ table: table?._table, values })
          return Promise.resolve(undefined)
        },
      }),
    })),
  }
})

import { NextRequest } from 'next/server'
import { GET as entriesGet, POST as entriesPost } from '@/app/api/admin/time-entries/route'
import { POST as requestTimePost } from '@/app/api/admin/requests/[id]/time-entries/route'
import { resolveLoggingTeamMemberId, timeEntryLoggerJoin } from '@/lib/time-entries'
import { db } from '@/lib/db'

type Drizzle = Parameters<typeof resolveLoggingTeamMemberId>[0]

async function drizzle(): Promise<Drizzle> {
  return (await db()) as unknown as Drizzle
}

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

const LIAM = { id: 'tm_liam', name: 'Liam Miller', role: 'admin', clerkUserId: 'clerk_liam' }
const STACI = { id: 'tm_staci', name: 'Staci Bonnie', role: 'member', clerkUserId: 'clerk_staci' }

beforeEach(() => {
  state.rows = {
    teamMembers: [LIAM, STACI],
    requests: [{ id: 'req_1', orgId: 'org_client_a', title: 'Homepage' }],
    organisations: [{ id: 'org_client_a', name: 'Client A', defaultHourlyRate: 180 }],
  }
  state.inserts = []
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
})

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------
describe('resolveLoggingTeamMemberId', () => {
  it('resolves the calling Clerk user to their team member row', async () => {
    const out = await resolveLoggingTeamMemberId(await drizzle(), { userId: 'clerk_staci' })
    expect(out).toEqual({ ok: true, teamMemberId: 'tm_staci' })
  })

  it('keeps an explicit team member id, which is a decision the caller made', async () => {
    const out = await resolveLoggingTeamMemberId(await drizzle(), { userId: 'clerk_liam', supplied: 'tm_staci' })
    expect(out).toEqual({ ok: true, teamMemberId: 'tm_staci' })
  })

  it('resolves a Clerk id handed over as a team member id rather than storing it', async () => {
    // This is the exact mistake the function exists to stop, and the person it
    // names is unambiguous, so it is corrected instead of refused.
    const out = await resolveLoggingTeamMemberId(await drizzle(), { userId: null, supplied: 'clerk_staci' })
    expect(out).toEqual({ ok: true, teamMemberId: 'tm_staci' })
  })

  it('refuses an id that matches no member at all', async () => {
    const out = await resolveLoggingTeamMemberId(await drizzle(), { userId: 'clerk_liam', supplied: 'tm_ghost' })
    expect(out).toMatchObject({ ok: false, failure: { status: 400 } })
  })

  it('refuses a caller with no team member row instead of naming nobody', async () => {
    const out = await resolveLoggingTeamMemberId(await drizzle(), { userId: 'clerk_stranger' })
    expect(out).toMatchObject({ ok: false, failure: { status: 400 } })
    expect(out.ok === false && out.failure.error).toContain('not linked to a team member')
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/time-entries
// ---------------------------------------------------------------------------
describe('POST /api/admin/time-entries owns the entry to a team member', () => {
  it('stores the team member id, not the Clerk id it was handed', async () => {
    const res = await entriesPost(post('/api/admin/time-entries', { requestId: 'req_1', hours: 2 }))
    expect(res.status).toBe(201)
    expect(loggedEntry().teamMemberId).toBe('tm_liam')
  })

  it('honours an explicit teamMemberId, so an admin can log for someone else', async () => {
    const res = await entriesPost(post('/api/admin/time-entries', {
      requestId: 'req_1', hours: 2, teamMemberId: 'tm_staci',
    }))
    expect(res.status).toBe(201)
    expect(loggedEntry().teamMemberId).toBe('tm_staci')
  })

  it('refuses an unresolvable caller rather than writing an orphan row', async () => {
    state.rows.teamMembers = []
    const res = await entriesPost(post('/api/admin/time-entries', { requestId: 'req_1', hours: 2 }))
    expect(res.status).toBe(400)
    expect((await res.json() as { error?: string }).error).toContain('not linked to a team member')
    expect(state.inserts).toHaveLength(0)
  })

  it('refuses a teamMemberId that names nobody', async () => {
    const res = await entriesPost(post('/api/admin/time-entries', {
      requestId: 'req_1', hours: 2, teamMemberId: 'tm_ghost',
    }))
    expect(res.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// The read-side fallback
// ---------------------------------------------------------------------------
describe('the logger join reaches rows written before the fix', () => {
  it('matches on the member id and on the Clerk id', () => {
    const on = timeEntryLoggerJoin() as unknown as { op: string; a: unknown[] }
    expect(on.op).toBe('or')
    expect(on.a).toHaveLength(2)
  })

  it('names a historical Clerk-id row instead of leaving it Unknown', async () => {
    state.rows.timeEntries = [
      // Written the old way: a Clerk id sitting in team_member_id.
      { id: 'te_old', requestId: 'req_1', teamMemberId: 'clerk_liam', hours: 1, date: '2026-08-01' },
      // Written the new way.
      { id: 'te_new', requestId: 'req_1', teamMemberId: 'tm_staci', hours: 2, date: '2026-09-01' },
    ]
    const res = await entriesGet(new NextRequest('http://localhost:3000/api/admin/time-entries?requestId=req_1'))
    expect(res.status).toBe(200)
    const body = await res.json() as { items: Array<{ id: string; teamMemberName: string | null }>; totalHours: number }
    const names = Object.fromEntries(body.items.map(i => [i.id, i.teamMemberName]))
    expect(names.te_old).toBe('Liam Miller')
    expect(names.te_new).toBe('Staci Bonnie')
    expect(body.totalHours).toBe(3)
  })

  it('still leaves a genuinely unowned row null rather than guessing', async () => {
    state.rows.timeEntries = [
      { id: 'te_orphan', requestId: 'req_1', teamMemberId: 'gone', hours: 1, date: '2026-08-01' },
    ]
    const res = await entriesGet(new NextRequest('http://localhost:3000/api/admin/time-entries?requestId=req_1'))
    const body = await res.json() as { items: Array<{ teamMemberName: string | null }> }
    expect(body.items[0].teamMemberName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/requests/[id]/time-entries
// ---------------------------------------------------------------------------
describe('POST /api/admin/requests/[id]/time-entries', () => {
  const params = { params: Promise.resolve({ id: 'req_1' }) }

  it('persists a rate sent on the body', async () => {
    const res = await requestTimePost(post('/api/admin/requests/req_1/time-entries', {
      hours: 2, description: 'Build', hourlyRate: 210,
    }), params)
    expect(res.status).toBe(200)
    expect(loggedEntry().hourlyRate).toBe(210)
    expect(loggedEntry().notes).toBe('Build')
  })

  it('falls back to the client default rate instead of storing nothing', async () => {
    const res = await requestTimePost(post('/api/admin/requests/req_1/time-entries', { hours: 2 }), params)
    expect(res.status).toBe(200)
    expect(loggedEntry().hourlyRate).toBe(180)
  })

  it('stores no rate rather than zero when the client has no default', async () => {
    state.rows.organisations = [{ id: 'org_client_a', name: 'Client A', defaultHourlyRate: null }]
    const res = await requestTimePost(post('/api/admin/requests/req_1/time-entries', { hours: 2 }), params)
    expect(res.status).toBe(200)
    expect(loggedEntry().hourlyRate).toBeNull()
  })

  it('keeps an explicit zero, which is a decision, not an absent rate', async () => {
    const res = await requestTimePost(post('/api/admin/requests/req_1/time-entries', {
      hours: 2, hourlyRate: 0,
    }), params)
    expect(res.status).toBe(200)
    expect(loggedEntry().hourlyRate).toBe(0)
  })

  it('refuses a negative or unusable rate instead of storing it', async () => {
    for (const hourlyRate of [-5, 'lots']) {
      state.inserts = []
      const res = await requestTimePost(post('/api/admin/requests/req_1/time-entries', {
        hours: 2, hourlyRate,
      }), params)
      expect(res.status).toBe(400)
      expect(state.inserts).toHaveLength(0)
    }
  })

  it('owns the entry to the calling team member', async () => {
    const res = await requestTimePost(post('/api/admin/requests/req_1/time-entries', { hours: 1 }), params)
    expect(res.status).toBe(200)
    expect(loggedEntry().teamMemberId).toBe('tm_liam')
  })

  it('refuses an unresolvable caller rather than writing an orphan row', async () => {
    state.rows.teamMembers = []
    const res = await requestTimePost(post('/api/admin/requests/req_1/time-entries', { hours: 1 }), params)
    expect(res.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })
})
