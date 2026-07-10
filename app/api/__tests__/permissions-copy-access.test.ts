/**
 * Unit tests for POST /api/admin/permissions/copy-access.
 *
 * The route replaces the target subject's access with a copy of the source's:
 * feature_visibility overrides always; for team members additionally the
 * level role (ending the target's active assignments, syncing the legacy
 * teamMembers.role column) and the data scope rule with its org list. For
 * organisations only feature overrides move. Everything is audit logged.
 *
 * We mock auth, both permission guards, audit, and db, then call the handler
 * directly. Writes are recorded as an ordered op list so the tests can assert
 * both what was written and the delete-before-insert replacement order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  innerJoin: () => SelectChain
  where: () => SelectChain
  orderBy: () => SelectChain
  limit: () => SelectChain
}

interface WriteOp {
  op: 'insert' | 'update' | 'delete'
  table: string
  values?: Record<string, unknown>
}

interface DbMockHandles {
  state: { queues: Record<string, Row[][]>; ops: WriteOp[] }
}

// ---------------------------------------------------------------------------
// Mocks - vi.mock factories cannot reference outer variables (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-permission', () => ({
  requireManagePermissions: vi.fn().mockResolvedValue({ denied: null, access: {} }),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    teamMembers: { _table: 'team_members', id: 'id', name: 'name', role: 'role' },
    organisations: { _table: 'organisations', id: 'id', name: 'name' },
    featureVisibility: {
      _table: 'feature_visibility',
      subjectType: 'subject_type',
      subjectId: 'subject_id',
      featureKey: 'feature_key',
      effect: 'effect',
      reason: 'reason',
    },
    teamMemberRoles: {
      _table: 'team_member_roles',
      teamMemberId: 'team_member_id',
      roleId: 'role_id',
      endedAt: 'ended_at',
    },
    roles: { _table: 'roles', id: 'id', name: 'name' },
    teamMemberAccess: { _table: 'team_member_access', id: 'id', teamMemberId: 'team_member_id' },
    teamMemberAccessOrgs: { _table: 'team_member_access_orgs', accessId: 'access_id', orgId: 'org_id' },
  },
}))

vi.mock('@/lib/db', () => {
  const state: DbMockHandles['state'] = { queues: {}, ops: [] }

  function chainFor(rows: Row[]): SelectChain {
    const chain = Promise.resolve(rows) as SelectChain
    chain.innerJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => chain
    return chain
  }

  const select = vi.fn(() => ({
    from: (table: { _table?: string } | undefined) => {
      const queue = state.queues[table?._table ?? ''] ?? []
      return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
    },
  }))

  const insert = vi.fn((table: { _table?: string }) => ({
    values: (v: Record<string, unknown>) => {
      state.ops.push({ op: 'insert', table: table?._table ?? '', values: v })
      return Promise.resolve(undefined)
    },
  }))

  const update = vi.fn((table: { _table?: string }) => ({
    set: (v: Record<string, unknown>) => ({
      where: () => {
        state.ops.push({ op: 'update', table: table?._table ?? '', values: v })
        return Promise.resolve(undefined)
      },
    }),
  }))

  const del = vi.fn((table: { _table?: string }) => ({
    where: () => {
      state.ops.push({ op: 'delete', table: table?._table ?? '' })
      return Promise.resolve(undefined)
    },
  }))

  return {
    db: vi.fn().mockResolvedValue({ select, insert, update, delete: del }),
    __mock: { state },
  }
})

// Import after mocks are set up
import { POST } from '@/app/api/admin/permissions/copy-access/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { logAudit } from '@/lib/audit'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/permissions/copy-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function opIndex(op: WriteOp['op'], table: string): number {
  return dbMock.state.ops.findIndex((o) => o.op === op && o.table === table)
}

function seedTeamMemberCopy() {
  dbMock.state.queues = {
    // Two lookups in order: source first, then target.
    team_members: [[{ id: 'tm_src', name: 'Source Sam' }], [{ id: 'tm_tgt', name: 'Target Tess' }]],
    // The source's feature overrides.
    feature_visibility: [[{ featureKey: 'tasks', effect: 'deny', reason: 'trial' }]],
    // The source's active role assignment.
    team_member_roles: [[{ roleId: 'role_task', roleName: 'task_handler' }]],
    // Scope rules: source's first, then the target's existing rules.
    team_member_access: [
      [{
        id: 'acc_src',
        teamMemberId: 'tm_src',
        role: 'task_handler',
        scopeType: 'specific_clients',
        planType: null,
        trackType: 'all',
        createdAt: 't0',
        updatedAt: 't0',
      }],
      [{ id: 'acc_tgt_old' }],
    ],
    // The org list attached to the source's specific_clients rule.
    team_member_access_orgs: [[{ orgId: 'org_1' }, { orgId: 'org_2' }]],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/admin/permissions/copy-access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.state.queues = {}
    dbMock.state.ops = []
  })

  it('returns 400 for missing ids, equal ids, and a bad subjectType', async () => {
    const missing = await POST(makeRequest({ subjectType: 'team_member', targetId: 'tm_b' }))
    expect(missing.status).toBe(400)

    const equal = await POST(makeRequest({ subjectType: 'team_member', sourceId: 'tm_a', targetId: 'tm_a' }))
    expect(equal.status).toBe(400)

    const badType = await POST(makeRequest({ subjectType: 'role', sourceId: 'tm_a', targetId: 'tm_b' }))
    expect(badType.status).toBe(400)
    const json = await badType.json() as { error?: string }
    expect(json.error).toBe('subjectType must be team_member | organisation')

    expect(dbMock.state.ops).toHaveLength(0)
  })

  it('returns 404 when the source or target lookup comes back empty', async () => {
    dbMock.state.queues = {
      team_members: [[{ id: 'tm_src', name: 'Source Sam' }], []],
    }

    const res = await POST(makeRequest({ subjectType: 'team_member', sourceId: 'tm_src', targetId: 'tm_gone' }))
    expect(res.status).toBe(404)
    const json = await res.json() as { error?: string }
    expect(json.error).toBe('Unknown source or target subject')
    expect(dbMock.state.ops).toHaveLength(0)
  })

  it('copies overrides, role, legacy role column, and scope rule for a team member', async () => {
    seedTeamMemberCopy()

    const res = await POST(makeRequest({ subjectType: 'team_member', sourceId: 'tm_src', targetId: 'tm_tgt' }))
    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json).toMatchObject({
      ok: true,
      overridesCopied: 1,
      roleCopied: 'task_handler',
      scopeCopied: 'specific_clients',
    })

    const ops = dbMock.state.ops

    // Feature overrides: the target's rows are deleted before the source's
    // copies are inserted for the target subject.
    const fvDelete = opIndex('delete', 'feature_visibility')
    const fvInsert = opIndex('insert', 'feature_visibility')
    expect(fvDelete).toBeGreaterThanOrEqual(0)
    expect(fvInsert).toBeGreaterThan(fvDelete)
    expect(ops[fvInsert].values).toMatchObject({
      subjectType: 'team_member',
      subjectId: 'tm_tgt',
      featureKey: 'tasks',
      effect: 'deny',
      reason: 'trial',
    })

    // Level role: the target's active assignments are ended, then the
    // source's role is inserted for the target.
    const roleEnd = ops.find((o) => o.op === 'update' && o.table === 'team_member_roles')
    expect(roleEnd).toBeTruthy()
    expect(roleEnd?.values?.endedAt).toBeTruthy()
    const roleInsert = ops.find((o) => o.op === 'insert' && o.table === 'team_member_roles')
    expect(roleInsert?.values).toMatchObject({ teamMemberId: 'tm_tgt', roleId: 'role_task' })

    // Legacy teamMembers.role syncs to 'member' for a scoped role.
    const legacy = ops.find((o) => o.op === 'update' && o.table === 'team_members')
    expect(legacy?.values).toMatchObject({ role: 'member' })

    // Data scope: the target's old rule and its org rows are removed, the
    // source's rule is copied over, and the org list follows it.
    expect(opIndex('delete', 'team_member_access_orgs')).toBeGreaterThanOrEqual(0)
    expect(opIndex('delete', 'team_member_access')).toBeGreaterThanOrEqual(0)
    const accessInsert = ops.find((o) => o.op === 'insert' && o.table === 'team_member_access')
    expect(accessInsert?.values).toMatchObject({
      teamMemberId: 'tm_tgt',
      role: 'task_handler',
      scopeType: 'specific_clients',
      planType: null,
      trackType: 'all',
    })
    const orgInserts = ops.filter((o) => o.op === 'insert' && o.table === 'team_member_access_orgs')
    expect(orgInserts).toHaveLength(2)
    expect(orgInserts.map((o) => o.values?.orgId)).toEqual(['org_1', 'org_2'])
    for (const o of orgInserts) {
      expect(o.values?.accessId).toBe(accessInsert?.values?.id)
    }
  })

  it('syncs the legacy role column to admin when copying an admin-level role', async () => {
    dbMock.state.queues = {
      team_members: [[{ id: 'tm_src', name: 'Source Sam' }], [{ id: 'tm_tgt', name: 'Target Tess' }]],
      feature_visibility: [[]],
      team_member_roles: [[{ roleId: 'role_admin', roleName: 'admin' }]],
      team_member_access: [[], []],
    }

    const res = await POST(makeRequest({ subjectType: 'team_member', sourceId: 'tm_src', targetId: 'tm_tgt' }))
    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json).toMatchObject({ ok: true, overridesCopied: 0, roleCopied: 'admin', scopeCopied: null })

    const legacy = dbMock.state.ops.find((o) => o.op === 'update' && o.table === 'team_members')
    expect(legacy?.values).toMatchObject({ role: 'admin' })
  })

  it('touches only featureVisibility when copying between organisations', async () => {
    dbMock.state.queues = {
      organisations: [[{ id: 'org_src', name: 'Acme' }], [{ id: 'org_tgt', name: 'Zenith' }]],
      feature_visibility: [[{ featureKey: 'invoices', effect: 'deny', reason: null }]],
    }

    const res = await POST(makeRequest({ subjectType: 'organisation', sourceId: 'org_src', targetId: 'org_tgt' }))
    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json).toMatchObject({ ok: true, overridesCopied: 1, roleCopied: null, scopeCopied: null })

    const tables = new Set(dbMock.state.ops.map((o) => o.table))
    expect(tables).toEqual(new Set(['feature_visibility']))

    const fvInsert = dbMock.state.ops.find((o) => o.op === 'insert' && o.table === 'feature_visibility')
    expect(fvInsert?.values).toMatchObject({
      subjectType: 'organisation',
      subjectId: 'org_tgt',
      featureKey: 'invoices',
      effect: 'deny',
    })
  })

  it('writes a permission.access_copied audit entry', async () => {
    seedTeamMemberCopy()

    const res = await POST(makeRequest({ subjectType: 'team_member', sourceId: 'tm_src', targetId: 'tm_tgt' }))
    expect(res.status).toBe(200)

    expect(logAudit).toHaveBeenCalledTimes(1)
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'permission.access_copied',
        userId: 'user_admin',
        entityType: 'team_member',
        entityId: 'tm_tgt',
        metadata: expect.objectContaining({
          sourceId: 'tm_src',
          sourceName: 'Source Sam',
          targetName: 'Target Tess',
          overridesCopied: 1,
          roleCopied: 'task_handler',
          scopeCopied: 'specific_clients',
        }),
      }),
    )
  })
})
