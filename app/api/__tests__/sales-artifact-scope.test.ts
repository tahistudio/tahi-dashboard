/**
 * Unit tests for the per-org access scoping added to the contracts /
 * proposals / schedules admin routes.
 *
 * Two levels are covered:
 *   1. the pure decisions in app/api/admin/_sales-access/artifact-scope.ts
 *      (keep/drop a row, when the SQL pre-filter is safe to bind, guard
 *      outcomes for one artifact),
 *   2. two real route handlers (the proposals list GET and the proposal
 *      detail GET) driven through a fake D1 so the wiring is exercised, not
 *      just the helper.
 *
 * The fake database deliberately IGNORES the SQL where clause and returns
 * every configured row. That is the point: it proves the in-memory filter is
 * the authority and the SQL condition is only an optimisation.
 *
 * `scopedOrgIds` (the privileged-bypass resolver) and `resolveAccessScoping`
 * (the per-member org list) are the two leaf inputs, so they are mocked and
 * everything between them and the route runs for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

vi.mock('@/lib/access-scope', () => ({ scopedOrgIds: vi.fn() }))
vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_pm',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { scopedOrgIds } from '@/lib/access-scope'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { db } from '@/lib/db'
import {
  MAX_BOUND_ORG_IDS,
  filterArtifactsByScope,
  keepArtifactForScope,
  requireArtifactAccess,
  requireProposalAccess,
  scopedOrgCondition,
} from '@/app/api/admin/_sales-access/artifact-scope'
import { GET as listProposals } from '@/app/api/admin/proposals/route'
import { GET as getProposal } from '@/app/api/admin/proposals/[id]/route'

// ---------------------------------------------------------------------------
// Fake D1: rows are keyed by drizzle table identity, where clauses recorded.
// ---------------------------------------------------------------------------

interface FakeChain {
  leftJoin: () => FakeChain
  innerJoin: () => FakeChain
  where: (clause?: unknown) => FakeChain
  orderBy: () => FakeChain
  groupBy: () => FakeChain
  limit: () => Promise<Row[]>
  then: <T1 = Row[], T2 = never>(
    onfulfilled?: ((value: Row[]) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ) => Promise<T1 | T2>
}

interface FakeState {
  rows: Map<unknown, Row[]>
  wheres: Array<{ table: unknown; clause: unknown }>
  selectCount: number
}

function newState(): FakeState {
  return { rows: new Map(), wheres: [], selectCount: 0 }
}

function makeDb(state: FakeState): DrizzleDB {
  const chainFor = (table: unknown): FakeChain => {
    const rows = (): Row[] => state.rows.get(table) ?? []
    const chain: FakeChain = {
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: (clause?: unknown) => {
        state.wheres.push({ table, clause })
        return chain
      },
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => Promise.resolve(rows()),
      then: (onfulfilled, onrejected) => Promise.resolve(rows()).then(onfulfilled, onrejected),
    }
    return chain
  }
  return {
    select: () => {
      state.selectCount += 1
      return { from: (table: unknown) => chainFor(table) }
    },
  } as unknown as DrizzleDB
}

/** A database that fails the test if it is touched at all. */
function explodingDb(): DrizzleDB {
  return {
    select: () => {
      throw new Error('database must not be queried for an unrestricted caller')
    },
  } as unknown as DrizzleDB
}

const ADMIN_AUTH = { userId: 'user_owner', orgId: 'org_tahi' }
const PM_AUTH = { userId: 'user_pm', orgId: 'org_tahi' }

let state: FakeState

beforeEach(() => {
  vi.clearAllMocks()
  state = newState()
  vi.mocked(db).mockResolvedValue(makeDb(state) as never)
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

describe('keepArtifactForScope', () => {
  const allowed = new Set(['org_a'])
  const dealOrgs = new Map<string, string | null>([
    ['deal_a', 'org_a'],
    ['deal_b', 'org_b'],
    ['deal_orphan', null],
  ])

  it('keeps a row owned by an allowed org', () => {
    expect(keepArtifactForScope({ orgId: 'org_a', dealId: null }, allowed, dealOrgs)).toBe(true)
  })

  it('drops a row owned by another org', () => {
    expect(keepArtifactForScope({ orgId: 'org_b', dealId: null }, allowed, dealOrgs)).toBe(false)
  })

  it('falls back to the linked deal when org_id is null', () => {
    expect(keepArtifactForScope({ orgId: null, dealId: 'deal_a' }, allowed, dealOrgs)).toBe(true)
    expect(keepArtifactForScope({ orgId: null, dealId: 'deal_b' }, allowed, dealOrgs)).toBe(false)
  })

  it('drops an unassigned row: no org, and no deal that resolves to one', () => {
    expect(keepArtifactForScope({ orgId: null, dealId: null }, allowed, dealOrgs)).toBe(false)
    expect(keepArtifactForScope({ orgId: null, dealId: 'deal_orphan' }, allowed, dealOrgs)).toBe(false)
    expect(keepArtifactForScope({ orgId: null, dealId: 'deal_unknown' }, allowed, dealOrgs)).toBe(false)
  })

  it('ignores the deal fallback once org_id is set', () => {
    expect(keepArtifactForScope({ orgId: 'org_b', dealId: 'deal_a' }, allowed, dealOrgs)).toBe(false)
  })
})

describe('scopedOrgCondition', () => {
  it('builds a condition for a normal scope', () => {
    expect(scopedOrgCondition(schema.proposals.orgId, ['org_a', 'org_b'])).toBeDefined()
  })

  it('returns nothing for an empty scope, which callers must short-circuit', () => {
    expect(scopedOrgCondition(schema.proposals.orgId, [])).toBeUndefined()
  })

  it('skips the SQL bind past D1 bound-parameter headroom', () => {
    const many = Array.from({ length: MAX_BOUND_ORG_IDS + 1 }, (_, i) => `org_${i}`)
    expect(scopedOrgCondition(schema.proposals.orgId, many)).toBeUndefined()
    expect(scopedOrgCondition(schema.proposals.orgId, many.slice(0, MAX_BOUND_ORG_IDS))).toBeDefined()
  })
})

describe('filterArtifactsByScope', () => {
  it('resolves deal linkage and keeps only in-scope rows', async () => {
    state.rows.set(schema.deals, [
      { id: 'deal_a', orgId: 'org_a' },
      { id: 'deal_b', orgId: 'org_b' },
    ])
    const rows = [
      { id: 'x1', orgId: 'org_a', dealId: null },
      { id: 'x2', orgId: 'org_b', dealId: null },
      { id: 'x3', orgId: null, dealId: 'deal_a' },
      { id: 'x4', orgId: null, dealId: 'deal_b' },
      { id: 'x5', orgId: null, dealId: null },
    ]
    const kept = await filterArtifactsByScope(makeDb(state), rows, ['org_a'])
    expect(kept.map(r => r.id)).toEqual(['x1', 'x3'])
  })
})

// ---------------------------------------------------------------------------
// Single-artifact guards
// ---------------------------------------------------------------------------

describe('requireArtifactAccess', () => {
  it('lets an unrestricted caller through without touching the database', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'all' })
    const denied = await requireArtifactAccess(explodingDb(), ADMIN_AUTH, { orgId: null, dealId: null })
    expect(denied).toBeNull()
  })

  it('denies a caller scoped to nothing', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'none' })
    const denied = await requireArtifactAccess(makeDb(state), PM_AUTH, { orgId: 'org_a', dealId: null })
    expect(denied?.status).toBe(403)
  })

  it('allows a scoped caller on their own org', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    const denied = await requireArtifactAccess(makeDb(state), PM_AUTH, { orgId: 'org_a', dealId: null })
    expect(denied).toBeNull()
  })

  it('denies a scoped caller on another client', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    const denied = await requireArtifactAccess(makeDb(state), PM_AUTH, { orgId: 'org_b', dealId: null })
    expect(denied?.status).toBe(403)
  })

  it('resolves the owning org through the linked deal', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    state.rows.set(schema.deals, [{ orgId: 'org_a' }])
    const denied = await requireArtifactAccess(makeDb(state), PM_AUTH, { orgId: null, dealId: 'deal_a' })
    expect(denied).toBeNull()
  })

  it('denies a scoped caller on an unassigned artifact', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    const denied = await requireArtifactAccess(makeDb(state), PM_AUTH, { orgId: null, dealId: null })
    expect(denied?.status).toBe(403)
  })

  it('404s a scoped caller when the parent row does not exist', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    const denied = await requireArtifactAccess(makeDb(state), PM_AUTH, undefined)
    expect(denied?.status).toBe(404)
  })
})

describe('requireProposalAccess', () => {
  it('denies a scoped caller on a proposal belonging to another client', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    state.rows.set(schema.proposals, [{ orgId: 'org_b', dealId: null }])
    const denied = await requireProposalAccess(makeDb(state), PM_AUTH, 'p_other')
    expect(denied?.status).toBe(403)
  })

  it('allows a scoped caller on a proposal for one of their clients', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    state.rows.set(schema.proposals, [{ orgId: 'org_a', dealId: null }])
    expect(await requireProposalAccess(makeDb(state), PM_AUTH, 'p_mine')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Real route handlers
// ---------------------------------------------------------------------------

interface ListBody { items: Array<{ id: string }> }

function listRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/proposals')
}

function detailRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/proposals/p1')
}

describe('GET /api/admin/proposals', () => {
  it('returns every proposal unfiltered for an unrestricted caller', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'all' })
    state.rows.set(schema.proposals, [
      { id: 'p1', orgId: 'org_a', dealId: null },
      { id: 'p2', orgId: 'org_b', dealId: null },
      { id: 'p3', orgId: null, dealId: null },
    ])

    const res = await listProposals(listRequest())
    const body = await res.json() as ListBody

    expect(body.items.map(i => i.id)).toEqual(['p1', 'p2', 'p3'])
    // No filters requested and no scoping, so the query carries no where clause.
    expect(state.wheres.find(w => w.table === schema.proposals)?.clause).toBeUndefined()
  })

  it('filters a scoped caller down to their clients, deal linkage included', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    state.rows.set(schema.proposals, [
      { id: 'p1', orgId: 'org_a', dealId: null },
      { id: 'p2', orgId: 'org_b', dealId: null },
      { id: 'p3', orgId: null, dealId: 'deal_a' },
      { id: 'p4', orgId: null, dealId: 'deal_b' },
      { id: 'p5', orgId: null, dealId: null },
    ])
    state.rows.set(schema.deals, [
      { id: 'deal_a', orgId: 'org_a' },
      { id: 'deal_b', orgId: 'org_b' },
    ])

    const res = await listProposals(listRequest())
    const body = await res.json() as ListBody

    expect(body.items.map(i => i.id)).toEqual(['p1', 'p3'])
    // The SQL pre-filter is applied too, even though the fake ignores it.
    expect(state.wheres.find(w => w.table === schema.proposals)?.clause).toBeDefined()
  })

  it('returns nothing, and never queries, for a caller scoped to no orgs', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'none' })
    state.rows.set(schema.proposals, [{ id: 'p1', orgId: 'org_a', dealId: null }])

    const res = await listProposals(listRequest())
    const body = await res.json() as ListBody

    expect(body.items).toEqual([])
    expect(vi.mocked(db)).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/proposals/[id]', () => {
  it('403s a scoped caller opening another client proposal', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    state.rows.set(schema.proposals, [{ id: 'p2', orgId: 'org_b', dealId: null, title: 'Theirs' }])

    const res = await getProposal(detailRequest(), { params: Promise.resolve({ id: 'p2' }) })
    expect(res.status).toBe(403)
  })

  it('serves a scoped caller their own client proposal', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    state.rows.set(schema.proposals, [{ id: 'p1', orgId: 'org_a', dealId: null, title: 'Mine' }])

    const res = await getProposal(detailRequest(), { params: Promise.resolve({ id: 'p1' }) })
    expect(res.status).toBe(200)
  })

  it('leaves an unassigned draft readable by an unrestricted caller', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'all' })
    state.rows.set(schema.proposals, [{ id: 'p3', orgId: null, dealId: null, title: 'Draft' }])

    const res = await getProposal(detailRequest(), { params: Promise.resolve({ id: 'p3' }) })
    expect(res.status).toBe(200)
  })
})
