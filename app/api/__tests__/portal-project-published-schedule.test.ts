/**
 * Unit tests for GET /api/portal/project - the client home "Your project" card.
 *
 * The route used to take the newest projectSchedules row for the org with no
 * status filter and read its phase names off the live schedule_rows table, so
 * an in-progress draft (or unpublished edits to a shared schedule) rendered on
 * a paying client's home. It now reads the newest schedule with status
 * 'shared' and takes the whole cover plus the phase rows from
 * publishedSnapshot, choosing the source once per snapshot so a field the
 * snapshot published as null cannot fall back to the live column.
 *
 * A shared schedule with no usable snapshot (never published, or a snapshot
 * that will not parse) deliberately keeps reading live, because that is what
 * the client's own share link serves for it. Those two cases are pinned below
 * so the parity is a decision and not an accident.
 *
 * The db mock is a small in-memory D1: it evaluates the eq / and / inArray
 * conditions, applies orderBy with SQLite null ordering and limit, and then
 * reduces rows to the select() projection, exactly like drizzle does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface ColRef { _table: string; _col: string }
interface Cond { op: string; col?: ColRef; val?: unknown; vals?: unknown[]; conds?: Cond[] }
interface Order { col: ColRef; dir: 'asc' | 'desc' }

const state: { tables: Record<string, Row[]> } = { tables: {} }

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))

function table(name: string, cols: string[]): Record<string, unknown> {
  const t: Record<string, unknown> = { _table: name }
  for (const c of cols) t[c] = { _table: name, _col: c }
  return t
}

vi.mock('@/db/d1', () => ({
  schema: {
    subscriptions: table('subscriptions', ['id', 'orgId', 'status']),
    projects: table('projects', ['name', 'status', 'expectedDelivery', 'orgId', 'createdAt']),
    projectSchedules: table('projectSchedules', [
      'id', 'orgId', 'status', 'title', 'effectiveDate', 'targetLaunchDate',
      'publishedSnapshot', 'publishedAt', 'createdAt',
    ]),
    scheduleRows: table('scheduleRows', [
      'scheduleId', 'rowType', 'label', 'startWeek', 'endWeek', 'position',
    ]),
    invoices: table('invoices', ['orgId', 'status', 'dueDate']),
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: ColRef, val: unknown): Cond => ({ op: 'eq', col, val }),
  and: (...conds: Cond[]): Cond => ({ op: 'and', conds }),
  inArray: (col: ColRef, vals: unknown[]): Cond => ({ op: 'inArray', col, vals }),
  asc: (col: ColRef): Order => ({ col, dir: 'asc' }),
  desc: (col: ColRef): Order => ({ col, dir: 'desc' }),
}))

function matches(row: Row, cond: Cond | undefined): boolean {
  if (!cond) return true
  if (cond.op === 'and') return (cond.conds ?? []).every(c => matches(row, c))
  if (cond.op === 'eq') return row[cond.col?._col ?? ''] === cond.val
  if (cond.op === 'inArray') return (cond.vals ?? []).includes(row[cond.col?._col ?? ''])
  return true
}

// SQLite orders NULL as the smallest value, so ASC puts nulls first and DESC
// puts them last. The route leans on that to prefer published schedules.
function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

vi.mock('@/lib/db', () => {
  function chainFor(tableName: string, projection?: Record<string, unknown>) {
    let where: Cond | undefined
    let orders: Order[] = []
    let lim: number | undefined
    const run = (): Row[] => {
      let rows = (state.tables[tableName] ?? []).filter(r => matches(r, where))
      if (orders.length > 0) {
        rows = [...rows].sort((x, y) => {
          for (const o of orders) {
            const c = compare(x[o.col._col], y[o.col._col])
            if (c !== 0) return o.dir === 'desc' ? -c : c
          }
          return 0
        })
      }
      if (lim != null) rows = rows.slice(0, lim)
      if (!projection) return rows
      return rows.map(r => Object.fromEntries(Object.keys(projection).map(k => [k, r[k] ?? null])))
    }
    const chain = {
      where(cond: Cond) { where = cond; return chain },
      orderBy(...o: Order[]) { orders = o; return chain },
      limit(n: number) { lim = n; return chain },
      then<T>(resolve: (rows: Row[]) => T, reject?: (err: unknown) => T) {
        return Promise.resolve().then(run).then(resolve, reject)
      },
    }
    return chain
  }
  const select = (projection?: Record<string, unknown>) => ({
    from: (t: { _table?: string } | undefined) => chainFor(t?._table ?? '', projection),
  })
  return { db: vi.fn().mockResolvedValue({ select }) }
})

import { GET } from '@/app/api/portal/project/route'
import { NextRequest } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client',
    orgId: 'org_client',
    sessionId: 'sess_1',
    clerkOrgId: 'org_client',
    impersonating: false,
    ...overrides,
  }
}

function makeGet(): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/project', { method: 'GET' })
}

const DAY_MS = 24 * 60 * 60 * 1000
// 15 days in puts "current week" at week 3 of the schedule.
const EFFECTIVE = new Date(Date.now() - 15 * DAY_MS).toISOString()

// The published plan the client is allowed to read. Deliberately out of
// position order so the route has to sort by `position` itself.
const PUBLISHED_ROWS = [
  { id: 'r5', sectionId: 'sec1', rowType: 'gate', label: 'Design sign off', startWeek: 5, endWeek: 5, position: 5 },
  { id: 'r0', sectionId: 'sec1', rowType: 'section_header', label: 'Discovery', startWeek: null, endWeek: null, position: 0 },
  { id: 'r1', sectionId: 'sec1', rowType: 'task', label: 'Kickoff workshop', startWeek: 1, endWeek: 2, position: 1 },
  { id: 'r2', sectionId: 'sec1', rowType: 'gate', label: 'Discovery sign off', startWeek: 2, endWeek: 2, position: 2 },
  { id: 'r3', sectionId: 'sec1', rowType: 'section_header', label: 'Design', startWeek: null, endWeek: null, position: 3 },
  { id: 'r4', sectionId: 'sec1', rowType: 'task', label: 'Homepage concepts', startWeek: 3, endWeek: 5, position: 4 },
  { id: 'r6', sectionId: 'sec1', rowType: 'section_header', label: 'Build', startWeek: null, endWeek: null, position: 6 },
  { id: 'r7', sectionId: 'sec1', rowType: 'task', label: 'Build and QA', startWeek: 6, endWeek: 9, position: 7 },
]

const PUBLISHED_SNAPSHOT = JSON.stringify({
  schedule: {
    title: 'Acme website build',
    effectiveDate: EFFECTIVE,
    targetLaunchDate: '2026-12-01',
    numberOfWeeks: 12,
  },
  sections: [{ id: 'sec1', type: 'gantt', position: 0 }],
  rows: PUBLISHED_ROWS,
})

// The same plan published at kickoff, before anyone filled the dates in. Both
// columns are nullable, so this is an ordinary state and not a corrupt write.
const PUBLISHED_SNAPSHOT_NO_DATES = JSON.stringify({
  schedule: {
    title: 'Acme website build',
    effectiveDate: null,
    targetLaunchDate: null,
    numberOfWeeks: 12,
  },
  sections: [{ id: 'sec1', type: 'gantt', position: 0 }],
  rows: PUBLISHED_ROWS,
})

const SHARED_SCHEDULE: Row = {
  id: 'sch_shared',
  orgId: 'org_client',
  status: 'shared',
  // Live columns carry unpublished edits; the client must not see them.
  title: 'Acme website build (renegotiating scope)',
  effectiveDate: EFFECTIVE,
  targetLaunchDate: '2027-03-01',
  publishedSnapshot: PUBLISHED_SNAPSHOT,
  publishedAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

// Live rows for the shared schedule, renamed since the last publish.
const LIVE_ROWS_FOR_SHARED: Row[] = [
  { scheduleId: 'sch_shared', rowType: 'section_header', label: 'Discovery (unbilled rework)', startWeek: null, endWeek: null, position: 0 },
  { scheduleId: 'sch_shared', rowType: 'task', label: 'Chase the client for assets', startWeek: 1, endWeek: 2, position: 1 },
]

// A brand new internal draft, created after the shared one was published.
const NEWER_DRAFT: Row = {
  id: 'sch_draft',
  orgId: 'org_client',
  status: 'draft',
  title: 'Acme replan v3, internal only',
  effectiveDate: EFFECTIVE,
  targetLaunchDate: '2027-06-01',
  publishedSnapshot: null,
  publishedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
}

const DRAFT_ROWS: Row[] = [
  { scheduleId: 'sch_draft', rowType: 'section_header', label: 'Damage control', startWeek: null, endWeek: null, position: 0 },
  { scheduleId: 'sch_draft', rowType: 'task', label: 'Rebuild the estimate internally', startWeek: 1, endWeek: 4, position: 1 },
]

// Published with no dates, then both dates typed into the live row and never
// published again. The live values are unpublished edits like any other.
const SHARED_PUBLISHED_WITHOUT_DATES: Row = {
  ...SHARED_SCHEDULE,
  title: 'Acme website build',
  publishedSnapshot: PUBLISHED_SNAPSHOT_NO_DATES,
  effectiveDate: EFFECTIVE,
  targetLaunchDate: '2027-06-01',
}

// An older plan the admin reopened and republished today. Still 'shared',
// because sharing a new schedule does not unshare the previous one.
const OLDER_REPUBLISHED: Row = {
  id: 'sch_old',
  orgId: 'org_client',
  status: 'shared',
  title: 'Acme discovery sprint',
  effectiveDate: EFFECTIVE,
  targetLaunchDate: '2026-04-01',
  publishedSnapshot: JSON.stringify({
    schedule: {
      title: 'Acme discovery sprint',
      effectiveDate: EFFECTIVE,
      targetLaunchDate: '2026-04-01',
      numberOfWeeks: 4,
    },
    sections: [{ id: 'secA', type: 'gantt', position: 0 }],
    rows: [
      { id: 'a0', sectionId: 'secA', rowType: 'section_header', label: 'Sprint zero', startWeek: null, endWeek: null, position: 0 },
      { id: 'a1', sectionId: 'secA', rowType: 'task', label: 'Stakeholder interviews', startWeek: 1, endWeek: 2, position: 1 },
    ],
  }),
  // Republished after the current plan was published, but created long before.
  publishedAt: '2026-09-02T00:00:00.000Z',
  createdAt: '2026-01-05T00:00:00.000Z',
}

const PROJECT_ROW: Row = {
  name: 'Acme website',
  status: 'active',
  expectedDelivery: '2026-11-15',
  orgId: 'org_client',
  createdAt: '2026-05-01T00:00:00.000Z',
}

interface ProjectResponse {
  isProject: boolean
  scheduleTitle: string | null
  project: { name: string; status: string; targetLaunchDate: string | null } | null
  phases: Array<{ name: string; state: string; pct: number; note: string | null }>
  progressKnown: boolean
  nextMilestone: { name: string; dateISO: string | null } | null
  nextInvoice: { dateISO: string } | null
  targetLaunchDate: string | null
}

describe('GET /api/portal/project reads the published schedule only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
    state.tables = { subscriptions: [], projects: [PROJECT_ROW], projectSchedules: [], scheduleRows: [], invoices: [] }
  })

  it('ignores a draft schedule newer than the published one', async () => {
    state.tables.projectSchedules = [NEWER_DRAFT, SHARED_SCHEDULE]
    state.tables.scheduleRows = [...DRAFT_ROWS, ...LIVE_ROWS_FOR_SHARED]

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json() as ProjectResponse

    expect(body.scheduleTitle).toBe('Acme website build')
    expect(body.phases.map(p => p.name)).toEqual(['Discovery', 'Design', 'Build'])

    // Nothing from the draft leaks, not the title and not a phase name.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('replan v3')
    expect(raw).not.toContain('Damage control')
    expect(raw).not.toContain('Rebuild the estimate')
  })

  it('takes phase names from the snapshot, not from live edits to the shared schedule', async () => {
    state.tables.projectSchedules = [SHARED_SCHEDULE]
    state.tables.scheduleRows = [...LIVE_ROWS_FOR_SHARED]

    const res = await GET(makeGet())
    const body = await res.json() as ProjectResponse

    const raw = JSON.stringify(body)
    expect(raw).not.toContain('unbilled rework')
    expect(raw).not.toContain('Chase the client')
    expect(body.scheduleTitle).toBe('Acme website build')
    // Published targetLaunchDate wins over the edited live column.
    expect(body.targetLaunchDate).toBe('2026-12-01')
  })

  it('derives progress and the next milestone from the published rows', async () => {
    state.tables.projectSchedules = [SHARED_SCHEDULE]

    const res = await GET(makeGet())
    const body = await res.json() as ProjectResponse

    expect(body.progressKnown).toBe(true)
    expect(body.phases).toEqual([
      { name: 'Discovery', state: 'done', pct: 100, note: null },
      { name: 'Design', state: 'active', pct: 33, note: 'Homepage concepts' },
      { name: 'Build', state: 'upcoming', pct: 0, note: null },
    ])
    expect(body.nextMilestone?.name).toBe('Design sign off')
    expect(body.nextMilestone?.dateISO).not.toBeNull()
  })

  it('returns the empty shape when the org has no published schedule', async () => {
    state.tables.projectSchedules = [NEWER_DRAFT]
    state.tables.scheduleRows = [...DRAFT_ROWS]

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json() as ProjectResponse

    expect(body).toEqual({
      isProject: true,
      scheduleTitle: null,
      project: { name: 'Acme website', status: 'active', targetLaunchDate: '2026-11-15' },
      phases: [],
      progressKnown: false,
      nextMilestone: null,
      nextInvoice: null,
      // Falls back to the project record when no schedule is published.
      targetLaunchDate: '2026-11-15',
    })
  })

  it('keeps a date the snapshot published as null instead of reading the live column', async () => {
    state.tables.projectSchedules = [SHARED_PUBLISHED_WITHOUT_DATES]

    const res = await GET(makeGet())
    const body = await res.json() as ProjectResponse

    // The live targetLaunchDate was never published, so the card falls to the
    // project record rather than promising the client a date off an edit.
    expect(body.targetLaunchDate).toBe('2026-11-15')
    expect(JSON.stringify(body)).not.toContain('2027-06-01')

    // With no published effective date there is no anchor, so no percentages
    // and no milestone date are asserted: the phases render as a plain roadmap.
    expect(body.progressKnown).toBe(false)
    expect(body.nextMilestone).toBeNull()
    expect(body.phases).toEqual([
      { name: 'Discovery', state: 'upcoming', pct: 0, note: null },
      { name: 'Design', state: 'upcoming', pct: 0, note: null },
      { name: 'Build', state: 'upcoming', pct: 0, note: null },
    ])
  })

  it('prefers the newest shared schedule over an older one republished later', async () => {
    state.tables.projectSchedules = [OLDER_REPUBLISHED, SHARED_SCHEDULE]

    const res = await GET(makeGet())
    const body = await res.json() as ProjectResponse

    expect(body.scheduleTitle).toBe('Acme website build')
    expect(body.phases.map(p => p.name)).toEqual(['Discovery', 'Design', 'Build'])

    const raw = JSON.stringify(body)
    expect(raw).not.toContain('discovery sprint')
    expect(raw).not.toContain('Sprint zero')
    expect(raw).not.toContain('Stakeholder interviews')
  })

  it('reads live values for a shared schedule that was never published', async () => {
    // Sharing does not write a snapshot, so this is the ordinary state of a
    // freshly shared plan, not a pre-migration relic. Live is what the client's
    // own share link serves for it, so the card matches the link.
    state.tables.projectSchedules = [{ ...SHARED_SCHEDULE, publishedSnapshot: null, publishedAt: null }]
    state.tables.scheduleRows = [
      { scheduleId: 'sch_shared', rowType: 'section_header', label: 'Discovery', startWeek: null, endWeek: null, position: 0 },
      { scheduleId: 'sch_shared', rowType: 'task', label: 'Kickoff workshop', startWeek: 1, endWeek: 2, position: 1 },
    ]

    const res = await GET(makeGet())
    const body = await res.json() as ProjectResponse

    expect(body.phases.map(p => p.name)).toEqual(['Discovery'])
    expect(body.scheduleTitle).toBe('Acme website build (renegotiating scope)')
    expect(body.targetLaunchDate).toBe('2027-03-01')
  })

  it('reads live values when the snapshot will not parse, like the public viewer', async () => {
    state.tables.projectSchedules = [{ ...SHARED_SCHEDULE, publishedSnapshot: '{not json' }]
    state.tables.scheduleRows = [...LIVE_ROWS_FOR_SHARED]

    const res = await GET(makeGet())
    const body = await res.json() as ProjectResponse

    expect(body.scheduleTitle).toBe('Acme website build (renegotiating scope)')
    expect(body.phases.map(p => p.name)).toEqual(['Discovery (unbilled rework)'])
    expect(body.targetLaunchDate).toBe('2027-03-01')
  })

  it('still returns the retainer shape for a client with an active subscription', async () => {
    state.tables.subscriptions = [{ id: 'sub1', orgId: 'org_client', status: 'active' }]
    state.tables.projectSchedules = [SHARED_SCHEDULE]

    const res = await GET(makeGet())
    const body = await res.json() as { isProject: boolean }
    expect(body).toEqual({ isProject: false })
  })

  it('rejects the Tahi admin org', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ orgId: 'org_tahi' }))
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
  })
})
