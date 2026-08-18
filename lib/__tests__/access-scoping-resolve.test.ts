/**
 * Unit tests for lib/access-scoping.ts resolveAccessScoping.
 *
 * The security-relevant fix under test: the teamMemberRoles lookup that
 * decides admin/unrestricted scope must only count ACTIVE role assignments
 * (isNull endedAt, mirroring lib/permissions.ts). A revoked admin role must
 * not keep granting unrestricted data scope. We stub the database, capture
 * the where() predicate for the roles query, and assert it references both
 * teamMemberId and endedAt.
 */
import { describe, it, expect } from 'vitest'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { schema } from '@/db/d1'

type Row = Record<string, unknown>

interface Capture {
  table: unknown
  where: unknown
}

type StubDb = Parameters<typeof resolveAccessScoping>[0]

/**
 * Minimal drizzle stub: select().from(table) pops the next queued row set
 * for that table; the chain is thenable so both `await q.where(...)` and
 * `await q.where(...).limit(1)` resolve. Every where() predicate is
 * captured per call for inspection.
 */
function makeDb(queues: Map<unknown, Row[][]>, captures: Capture[]): StubDb {
  function chainFor(rows: Row[], capture: Capture) {
    const chain: Record<string, unknown> = {}
    chain.innerJoin = () => chain
    chain.limit = () => chain
    chain.where = (predicate: unknown) => {
      capture.where = predicate
      return chain
    }
    chain.then = (
      resolve: (value: Row[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject)
    return chain
  }
  return {
    select: () => ({
      from: (table: unknown) => {
        const queue = queues.get(table) ?? []
        const rows = queue.length > 0 ? (queue.shift() as Row[]) : []
        const capture: Capture = { table, where: undefined }
        captures.push(capture)
        return chainFor(rows, capture)
      },
    }),
  } as unknown as StubDb
}

/** Walk a drizzle SQL tree looking for a specific column instance. */
function referencesColumn(node: unknown, column: unknown, seen = new Set<unknown>()): boolean {
  if (node === column) return true
  if (!node || typeof node !== 'object') return false
  if (seen.has(node)) return false
  seen.add(node)
  if (Array.isArray(node)) return node.some((n) => referencesColumn(n, column, seen))
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (Array.isArray(chunks)) return chunks.some((n) => referencesColumn(n, column, seen))
  return false
}

function seed(opts: {
  teamMember?: Row[]
  roleRows?: Row[]
  /**
   * The bootstrap probe: any ACTIVE role assignment in the whole workspace.
   * Non-empty = a seeded workspace, so the deny defaults stand. Empty = a
   * fresh/unseeded install, where denying would lock the operator out.
   * team_member_roles is queried at most twice (the member's own roles, then
   * the probe), and the own-roles query is skipped when no member row matched,
   * so queue them in exactly that order.
   */
  anyActiveRole?: Row[]
  accessRules?: Row[]
  accessOrgs?: Row[]
}): { db: StubDb; captures: Capture[] } {
  const roleQueue: Row[][] = []
  if ((opts.teamMember ?? []).length > 0) roleQueue.push(opts.roleRows ?? [])
  roleQueue.push(opts.anyActiveRole ?? [])

  const queues = new Map<unknown, Row[][]>([
    [schema.teamMembers, [opts.teamMember ?? []]],
    [schema.teamMemberRoles, roleQueue],
    [schema.teamMemberAccess, [opts.accessRules ?? []]],
    [schema.teamMemberAccessOrgs, [opts.accessOrgs ?? []]],
  ])
  const captures: Capture[] = []
  return { db: makeDb(queues, captures), captures }
}

describe('resolveAccessScoping', () => {
  it('filters the roles lookup to active assignments (isNull endedAt)', async () => {
    const { db, captures } = seed({
      teamMember: [{ id: 'tm_1', role: 'member' }],
      roleRows: [],
    })
    await resolveAccessScoping(db, 'user_1')

    const rolesCapture = captures.find((c) => c.table === schema.teamMemberRoles)
    expect(rolesCapture).toBeDefined()
    expect(referencesColumn(rolesCapture!.where, schema.teamMemberRoles.teamMemberId)).toBe(true)
    // The fix: an ended admin role row must be excluded at the query level.
    expect(referencesColumn(rolesCapture!.where, schema.teamMemberRoles.endedAt)).toBe(true)
  })

  it('denies by default when the only admin role has ended (DB returns no active rows)', async () => {
    // With the endedAt filter in place, a revoked admin's roles query
    // returns nothing; a member with no access rules gets an empty scope.
    const { db } = seed({
      teamMember: [{ id: 'tm_1', role: 'member' }],
      roleRows: [],
      accessRules: [],
    })
    expect(await resolveAccessScoping(db, 'user_1')).toEqual([])
  })

  it('grants unrestricted scope for an active admin role', async () => {
    const { db } = seed({
      teamMember: [{ id: 'tm_1', role: 'member' }],
      roleRows: [{ name: 'admin' }],
    })
    expect(await resolveAccessScoping(db, 'user_1')).toBeNull()
  })

  it('scoped new-system role overrides the legacy admin column', async () => {
    const { db } = seed({
      teamMember: [{ id: 'tm_1', role: 'admin' }],
      roleRows: [{ name: 'editor' }],
      accessRules: [],
    })
    expect(await resolveAccessScoping(db, 'user_1')).toEqual([])
  })

  it('keeps the legacy-admin no-lockout default on an UNSEEDED workspace', async () => {
    // No role assignment exists anywhere, so the legacy column is the only
    // signal there is and it still counts.
    const { db } = seed({
      teamMember: [{ id: 'tm_1', role: 'admin' }],
      roleRows: [],
      anyActiveRole: [],
    })
    expect(await resolveAccessScoping(db, 'user_1')).toBeNull()
  })

  it('the legacy admin column no longer grants unrestricted scope once roles are seeded', async () => {
    // team_members.role is still written by the team form and is not a
    // permission grant: with the roles table in use, this member falls through
    // to their access rules like anyone else (here: none configured -> deny).
    const { db } = seed({
      teamMember: [{ id: 'tm_1', role: 'admin' }],
      roleRows: [],
      anyActiveRole: [{ id: 'tmr_someone_else' }],
      accessRules: [],
    })
    expect(await resolveAccessScoping(db, 'user_1')).toEqual([])
  })

  it('collects org ids for specific_clients rules', async () => {
    const { db } = seed({
      teamMember: [{ id: 'tm_1', role: 'member' }],
      roleRows: [{ name: 'editor' }],
      accessRules: [{ id: 'rule_1', scopeType: 'specific_clients', planType: null }],
      accessOrgs: [{ orgId: 'org_a' }, { orgId: 'org_b' }],
    })
    expect(await resolveAccessScoping(db, 'user_1')).toEqual(['org_a', 'org_b'])
  })
})

describe('resolveAccessScoping - deny by default', () => {
  it('THE OWNER: a super_admin whose ONLY scope row is one specific client stays unrestricted', async () => {
    // Production shape: business@tahi.studio holds super_admin AND a
    // specific_clients teamMemberAccess row naming a single org. The role-name
    // rule is the only thing standing between the studio owner and losing
    // every other client, so it is pinned here explicitly.
    const { db } = seed({
      teamMember: [{ id: 'b3025c04-6cdd-4154-822c-5d4fbfb95b76', role: 'admin' }],
      roleRows: [{ name: 'super_admin' }],
      accessRules: [{ id: 'rule_narrow', scopeType: 'specific_clients', planType: null }],
      accessOrgs: [{ orgId: 'org_giant_group' }],
    })
    expect(await resolveAccessScoping(db, 'user_liam')).toBeNull()
  })

  it('the MCP service identity is unrestricted and reads nothing', async () => {
    const { db, captures } = seed({ anyActiveRole: [{ id: 'tmr_someone_else' }] })
    expect(await resolveAccessScoping(db, 'api-service')).toBeNull()
    expect(captures).toEqual([]) // answered before any lookup
  })

  it('no user context denies instead of allowing everything', async () => {
    const { db, captures } = seed({ anyActiveRole: [{ id: 'tmr_someone_else' }] })
    expect(await resolveAccessScoping(db, null)).toEqual([])
    expect(captures).toEqual([])
  })

  it('an identity with no team member row is denied on a seeded workspace', async () => {
    const { db } = seed({ teamMember: [], anyActiveRole: [{ id: 'tmr_someone_else' }] })
    expect(await resolveAccessScoping(db, 'user_stranger')).toEqual([])
  })

  it('BOOTSTRAP: an identity with no team member row keeps full scope on an unseeded workspace', async () => {
    const { db } = seed({ teamMember: [], anyActiveRole: [] })
    expect(await resolveAccessScoping(db, 'user_owner')).toBeNull()
  })

  it('a member with a scoped role and no access rule is denied', async () => {
    const { db } = seed({
      teamMember: [{ id: 'tm_hire', role: 'member' }],
      roleRows: [{ name: 'task_handler' }],
      accessRules: [],
    })
    expect(await resolveAccessScoping(db, 'user_hire')).toEqual([])
  })

  it('an all_clients rule is still an explicit grant', async () => {
    const { db } = seed({
      teamMember: [{ id: 'tm_pm', role: 'member' }],
      roleRows: [{ name: 'project_manager' }],
      accessRules: [{ id: 'rule_all', scopeType: 'all_clients', planType: null }],
    })
    expect(await resolveAccessScoping(db, 'user_pm')).toBeNull()
  })
})
