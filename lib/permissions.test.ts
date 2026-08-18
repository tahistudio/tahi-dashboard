import { describe, it, expect, beforeEach } from 'vitest'
import {
  decideFeature,
  featureMap,
  resolvePermissions,
  type ResolvedAccess,
  type Effect,
} from '@/lib/permissions'
import { schema } from '@/db/d1'

// Build a ResolvedAccess for a given level. `overrides` is a plain object for brevity.
function access(
  level: ResolvedAccess['level'],
  opts: {
    overrides?: Record<string, Effect>
    viewableResources?: string[] | null
    audience?: ResolvedAccess['audience']
  } = {},
): ResolvedAccess {
  const audience = opts.audience ?? (level === 'client' ? 'client' : 'team')
  return {
    userId: 'u', orgId: 'o', level, audience,
    isSuperAdmin: level === 'super_admin',
    isAdmin: level === 'super_admin' || level === 'admin',
    canManagePermissions: level === 'super_admin' || level === 'admin',
    viewableResources: opts.viewableResources === undefined ? null : (opts.viewableResources ? new Set(opts.viewableResources) : null),
    overrides: new Map(Object.entries(opts.overrides ?? {})),
  }
}

describe('decideFeature — levels', () => {
  it('super_admin sees every team feature, even with a deny override (un-lockable)', () => {
    const a = access('super_admin', { overrides: { requests: 'deny', tasks: 'deny' } })
    expect(decideFeature(a, 'requests')).toBe(true)
    expect(decideFeature(a, 'tasks')).toBe(true)
    expect(decideFeature(a, 'settings.permissions')).toBe(true)
  })

  it('admin sees team features by default, but a deny override hides one', () => {
    const a = access('admin')
    expect(decideFeature(a, 'tasks')).toBe(true)
    expect(decideFeature(a, 'financial_reports')).toBe(true)
    const denied = access('admin', { overrides: { financial_reports: 'deny' } })
    expect(decideFeature(denied, 'financial_reports')).toBe(false)
  })

  it('client sees client-audience features by default but NOT team-only ones', () => {
    const a = access('client')
    expect(decideFeature(a, 'requests')).toBe(true)   // shared audience
    expect(decideFeature(a, 'invoices')).toBe(true)   // shared
    expect(decideFeature(a, 'tasks')).toBe(false)     // team-only
    expect(decideFeature(a, 'financial_reports')).toBe(false) // team-only
    expect(decideFeature(a, 'team')).toBe(false)      // team-only
  })

  it('per-org deny hides a feature from a client', () => {
    const a = access('client', { overrides: { invoices: 'deny' } })
    expect(decideFeature(a, 'invoices')).toBe(false)
    expect(decideFeature(a, 'requests')).toBe(true)
  })

  it('team_member only sees features their role can .view (role baseline)', () => {
    // A task_handler-style role: can view requests + tasks, not invoices/deals.
    const a = access('team_member', { viewableResources: ['requests', 'tasks', 'time_entries', 'docs'] })
    expect(decideFeature(a, 'requests')).toBe(true)
    expect(decideFeature(a, 'tasks')).toBe(true)
    expect(decideFeature(a, 'invoices')).toBe(false) // no invoices.view
    expect(decideFeature(a, 'deals')).toBe(false)    // no deals.view
  })

  it('team_member: an allow override grants a feature the role baseline would deny', () => {
    const a = access('team_member', { viewableResources: ['requests'], overrides: { deals: 'allow' } })
    expect(decideFeature(a, 'deals')).toBe(true)
  })

  it('team_member: ungated features (no resource mapping) are allowed by default', () => {
    const a = access('team_member', { viewableResources: ['requests'] })
    // 'overview' and 'messages' have no FEATURE_RESOURCE mapping.
    expect(decideFeature(a, 'overview')).toBe(true)
    expect(decideFeature(a, 'messages')).toBe(true)
  })
})

describe('decideFeature - deny by default (no grant)', () => {
  // An EMPTY viewable set is the "holds no grant" marker: a Tahi-org identity
  // with no active role. It must deny MORE than the role baseline does, because
  // features with no resource mapping (overview, messages) are allowed to a
  // roled team member by design.
  it('a team member with no role sees nothing at all', () => {
    const a = access('team_member', { viewableResources: [] })
    expect(decideFeature(a, 'overview')).toBe(false)   // ungated feature
    expect(decideFeature(a, 'messages')).toBe(false)   // ungated feature
    expect(decideFeature(a, 'requests')).toBe(false)   // gated feature
    expect(decideFeature(a, 'clients')).toBe(false)
    expect(decideFeature(a, 'settings')).toBe(false)
    expect(decideFeature(a, 'settings.permissions')).toBe(false)
    expect(decideFeature(a, 'some.unknown.key')).toBe(false) // not even unknown keys
  })

  it('an explicit allow override still grants a single feature (a grant, not a default)', () => {
    const a = access('team_member', { viewableResources: [], overrides: { requests: 'allow' } })
    expect(decideFeature(a, 'requests')).toBe(true)
    expect(decideFeature(a, 'requests.board')).toBe(true) // inherits the parent allow
    expect(decideFeature(a, 'clients')).toBe(false)       // everything else stays denied
  })

  it('deny-all never reaches admin+ or clients (their viewable set is null)', () => {
    expect(decideFeature(access('super_admin'), 'overview')).toBe(true)
    expect(decideFeature(access('admin'), 'overview')).toBe(true)
    expect(decideFeature(access('client'), 'overview')).toBe(true)
  })
})

describe('decideFeature — ancestry cascade', () => {
  it('denying a parent cascades to a child with no own rule', () => {
    const a = access('admin', { overrides: { requests: 'deny' } })
    expect(decideFeature(a, 'requests')).toBe(false)
    expect(decideFeature(a, 'requests.board')).toBe(false)       // inherits parent deny
    expect(decideFeature(a, 'requests.bulk_actions')).toBe(false)
  })

  it('a child-specific rule beats the parent (most-specific wins)', () => {
    const a = access('admin', { overrides: { requests: 'deny', 'requests.board': 'allow' } })
    expect(decideFeature(a, 'requests')).toBe(false)
    expect(decideFeature(a, 'requests.board')).toBe(true) // own allow beats parent deny
  })
})

describe('decideFeature — edges', () => {
  it('unknown feature keys are not gated (allow)', () => {
    const a = access('client')
    expect(decideFeature(a, 'some.unknown.key')).toBe(true)
  })

  it('a team-only sub-feature is denied to clients even with an allow override', () => {
    // requests.bulk_actions is team-only; audience check precedes overrides.
    const a = access('client', { overrides: { 'requests.bulk_actions': 'allow' } })
    expect(decideFeature(a, 'requests.bulk_actions')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolvePermissions: the DB-backed level decision.
//
// This is where deny by default lives. The old resolver ended with
// `else level = 'admin'`, so a Tahi-org user with no role assigned WAS a full
// admin. These tests pin the new order and, just as importantly, the two
// identities that must never be caught by it: the MCP service token and an
// unseeded workspace.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type StubDb = Parameters<typeof resolvePermissions>[0]

/**
 * Minimal drizzle stub: select().from(table) pops the next queued result set
 * for that table and the chain is thenable, so `await q.where(...)`,
 * `await q.where(...).limit(1)` and `.innerJoin(...)` all resolve.
 */
function makeDb(queues: Map<unknown, Row[][]>, tablesSeen: unknown[]): StubDb {
  function chainFor(rows: Row[]) {
    const chain: Record<string, unknown> = {}
    chain.innerJoin = () => chain
    chain.limit = () => chain
    chain.where = () => chain
    chain.then = (
      resolve: (value: Row[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject)
    return chain
  }
  return {
    select: () => ({
      from: (table: unknown) => {
        tablesSeen.push(table)
        const queue = queues.get(table) ?? []
        return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
      },
    }),
  } as unknown as StubDb
}

function seedTeam(opts: {
  member?: Row[]
  /** Rows for the member's own ACTIVE role assignments. */
  memberRoles?: Row[]
  /** Rows for the bootstrap probe: any active assignment in the workspace. */
  anyActiveRole?: Row[]
  viewPerms?: Row[]
}): { db: StubDb; tablesSeen: unknown[] } {
  // team_member_roles is queried twice on the roleless path (own roles, then
  // the bootstrap probe) and the own-roles query is skipped entirely when no
  // member row matched, so queue in exactly that order.
  const roleQueue: Row[][] = []
  if ((opts.member ?? []).length > 0) roleQueue.push(opts.memberRoles ?? [])
  roleQueue.push(opts.anyActiveRole ?? [])

  const queues = new Map<unknown, Row[][]>([
    [schema.teamMembers, [opts.member ?? []]],
    [schema.teamMemberRoles, roleQueue],
    [schema.rolePermissions, [opts.viewPerms ?? []]],
    [schema.featureVisibility, [[], []]],
  ])
  const tablesSeen: unknown[] = []
  return { db: makeDb(queues, tablesSeen), tablesSeen }
}

describe('resolvePermissions - deny by default', () => {
  const TAHI = 'org_tahi_test'

  beforeEach(() => {
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI
  })

  it('a Tahi-org member with NO role sees nothing (the new hire case)', async () => {
    const { db } = seedTeam({
      member: [{ id: 'tm_hire', role: 'member' }],
      memberRoles: [],
      anyActiveRole: [{ id: 'tmr_someone_else' }], // workspace IS seeded
    })
    const resolved = await resolvePermissions(db, { userId: 'user_hire', orgId: TAHI })

    expect(resolved.level).toBe('team_member')
    expect(resolved.isAdmin).toBe(false)
    expect(resolved.isSuperAdmin).toBe(false)
    expect(resolved.canManagePermissions).toBe(false)
    expect(resolved.viewableResources?.size).toBe(0)
    expect(Object.values(featureMap(resolved)).some(Boolean)).toBe(false)
  })

  it('a Tahi-org login with no roster row at all is denied', async () => {
    const { db } = seedTeam({ member: [], anyActiveRole: [{ id: 'tmr_someone_else' }] })
    const resolved = await resolvePermissions(db, { userId: 'user_stranger', orgId: TAHI })

    expect(resolved.isAdmin).toBe(false)
    expect(resolved.viewableResources?.size).toBe(0)
    expect(Object.values(featureMap(resolved)).some(Boolean)).toBe(false)
  })

  it('an ended role does not grant: no active assignment means denied', async () => {
    // The endedAt filter lives in the query (asserted in
    // lib/__tests__/access-scoping-resolve.test.ts); here the DB returns no
    // active rows and the member must fall to deny, not to the old admin.
    const { db } = seedTeam({
      member: [{ id: 'tm_ex_admin', role: 'admin' }],
      memberRoles: [],
      anyActiveRole: [{ id: 'tmr_someone_else' }],
    })
    const resolved = await resolvePermissions(db, { userId: 'user_ex_admin', orgId: TAHI })

    expect(resolved.level).toBe('team_member')
    expect(resolved.isAdmin).toBe(false)
  })

  it('BOOTSTRAP: an unseeded workspace (no active assignment anywhere) keeps admin', async () => {
    const { db } = seedTeam({
      member: [{ id: 'tm_owner', role: 'admin' }],
      memberRoles: [],
      anyActiveRole: [], // nothing seeded: a fresh install must not lock out
    })
    const resolved = await resolvePermissions(db, { userId: 'user_owner', orgId: TAHI })

    expect(resolved.level).toBe('admin')
    expect(resolved.isAdmin).toBe(true)
    expect(resolved.viewableResources).toBeNull()
  })

  it('the MCP service token stays full admin without reading any table', async () => {
    const { db, tablesSeen } = seedTeam({ anyActiveRole: [{ id: 'tmr_someone_else' }] })
    const resolved = await resolvePermissions(db, { userId: 'api-service', orgId: TAHI })

    expect(resolved.level).toBe('admin')
    expect(resolved.isAdmin).toBe(true)
    expect(resolved.canManagePermissions).toBe(true)
    expect(resolved.viewableResources).toBeNull()
    expect(tablesSeen).toEqual([]) // no bootstrap probe, no role lookup
    expect(decideFeature(resolved, 'financial_reports')).toBe(true)
  })

  it('THE OWNER: super_admin resolves to super_admin and stays unrestricted', async () => {
    const { db } = seedTeam({
      member: [{ id: 'b3025c04-6cdd-4154-822c-5d4fbfb95b76', role: 'admin' }],
      memberRoles: [{ roleId: 'role-super-admin', name: 'super_admin' }],
      anyActiveRole: [{ id: 'tmr_superadmin_liam' }],
    })
    const resolved = await resolvePermissions(db, { userId: 'user_liam', orgId: TAHI })

    expect(resolved.level).toBe('super_admin')
    expect(resolved.isSuperAdmin).toBe(true)
    expect(resolved.isAdmin).toBe(true)
    expect(resolved.viewableResources).toBeNull()
    // Every TEAM feature stays on (client-only nodes are off by audience, not
    // by permission, which is why this is not a blanket every(Boolean)).
    const map = featureMap(resolved)
    for (const key of ['overview', 'requests', 'clients', 'financial_reports', 'team', 'settings', 'settings.permissions']) {
      expect(map[key]).toBe(true)
    }
  })

  it('an admin role resolves to admin and stays unrestricted', async () => {
    const { db } = seedTeam({
      member: [{ id: 'tm_admin', role: 'member' }],
      memberRoles: [{ roleId: 'role-admin', name: 'admin' }],
    })
    const resolved = await resolvePermissions(db, { userId: 'user_admin', orgId: TAHI })

    expect(resolved.level).toBe('admin')
    expect(resolved.isAdmin).toBe(true)
    expect(resolved.viewableResources).toBeNull()
  })

  it('a scoped role gets exactly its own view baseline, not deny-all', async () => {
    const { db } = seedTeam({
      member: [{ id: 'tm_handler', role: 'member' }],
      memberRoles: [{ roleId: 'role-task-handler', name: 'task_handler' }],
      viewPerms: [{ resource: 'requests' }, { resource: 'tasks' }],
    })
    const resolved = await resolvePermissions(db, { userId: 'user_handler', orgId: TAHI })

    expect(resolved.level).toBe('team_member')
    expect(resolved.isAdmin).toBe(false)
    expect(resolved.viewableResources).toEqual(new Set(['requests', 'tasks']))
    expect(decideFeature(resolved, 'requests')).toBe(true)
    expect(decideFeature(resolved, 'tasks')).toBe(true)
    expect(decideFeature(resolved, 'invoices')).toBe(false)
    expect(decideFeature(resolved, 'financial_reports')).toBe(false)
    // A role that holds a grant keeps the ungated surfaces it always had.
    expect(decideFeature(resolved, 'overview')).toBe(true)
  })
})
