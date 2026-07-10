/**
 * Unit tests for GET /api/admin/permissions/matrix.
 *
 * The matrix crosses every team-audience FEATURE_TREE key with every role.
 * Admin-level roles (super_admin / admin) baseline to allow on everything;
 * scoped roles baseline to their role's .view grants for FEATURE_RESOURCE
 * mapped keys and to allow for unmapped keys; role-level feature_visibility
 * overrides surface per cell, except for super_admin which is locked and
 * always reports override null.
 *
 * We mock auth, the permission guard, and db, then call the handler directly.
 * The real FEATURE_TREE and featureResource mapping are used on purpose so
 * the tests exercise the actual key-to-resource wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import type { ResolvedAccess } from '@/lib/permissions'

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  innerJoin: () => SelectChain
  where: () => SelectChain
  orderBy: () => SelectChain
  limit: () => SelectChain
}

interface DbMockHandles {
  state: { queues: Record<string, Row[][]> }
  select: ReturnType<typeof vi.fn>
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

vi.mock('@/db/d1', () => ({
  schema: {
    roles: { _table: 'roles', id: 'id', name: 'name', description: 'description' },
    rolePermissions: { _table: 'role_permissions', roleId: 'role_id', permissionId: 'permission_id' },
    permissions: { _table: 'permissions', id: 'id', action: 'action', resource: 'resource' },
    featureVisibility: {
      _table: 'feature_visibility',
      subjectType: 'subject_type',
      subjectId: 'subject_id',
      featureKey: 'feature_key',
      effect: 'effect',
    },
  },
}))

vi.mock('@/lib/db', () => {
  const state: DbMockHandles['state'] = { queues: {} }

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

  return {
    db: vi.fn().mockResolvedValue({ select }),
    __mock: { state, select },
  }
})

// Import after mocks are set up
import { GET } from '@/app/api/admin/permissions/matrix/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { requireManagePermissions } from '@/lib/require-permission'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/permissions/matrix')
}

interface MatrixResponse {
  roles: Array<{ id: string; name: string; description: string | null; locked: boolean }>
  featureKeys: string[]
  cells: Record<string, Record<string, { base: 'allow' | 'deny'; override: 'allow' | 'deny' | null }>>
}

function accessStub(overrides: Partial<ResolvedAccess> = {}): ResolvedAccess {
  return {
    userId: 'user_admin',
    orgId: 'org_tahi',
    level: 'admin',
    audience: 'team',
    isSuperAdmin: false,
    isAdmin: true,
    canManagePermissions: true,
    viewableResources: null,
    overrides: new Map(),
    ...overrides,
  }
}

// Deliberately scrambled so the ordering test proves the route sorts them.
const ROLES: Row[] = [
  { id: 'r_viewer', name: 'viewer', description: 'Read-only' },
  { id: 'r_task', name: 'task_handler', description: 'Scoped handler' },
  { id: 'r_super', name: 'super_admin', description: 'Owner' },
  { id: 'r_pm', name: 'project_manager', description: 'PM' },
  { id: 'r_admin', name: 'admin', description: 'Admin' },
]

function seed(opts: { viewGrants?: Row[]; overrides?: Row[] } = {}) {
  dbMock.state.queues = {
    roles: [ROLES.map((r) => ({ ...r }))],
    role_permissions: [opts.viewGrants ?? []],
    feature_visibility: [opts.overrides ?? []],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /api/admin/permissions/matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.state.queues = {}
  })

  it('returns 403 when requireManagePermissions denies', async () => {
    vi.mocked(requireManagePermissions).mockResolvedValueOnce({
      denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      access: accessStub({ canManagePermissions: false, isAdmin: false, level: 'team_member' }),
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('gives super_admin base allow everywhere and never surfaces an override', async () => {
    seed({
      // super_admin has NO .view grant on the tasks resource...
      viewGrants: [{ roleId: 'r_task', resource: 'requests' }],
      // ...and even a stored role-level override row must not surface.
      overrides: [{ subjectId: 'r_super', featureKey: 'tasks', effect: 'deny' }],
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as MatrixResponse

    expect(json.cells['tasks']['r_super']).toEqual({ base: 'allow', override: null })
    expect(json.cells['requests']['r_super']).toEqual({ base: 'allow', override: null })
  })

  it('bases a scoped role on its view grants for mapped keys and allow for unmapped keys', async () => {
    seed({
      viewGrants: [{ roleId: 'r_task', resource: 'requests' }],
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as MatrixResponse

    // 'requests' maps to the requests resource, which the role can view.
    expect(json.cells['requests']['r_task'].base).toBe('allow')
    // 'tasks' maps to the tasks resource, which the role cannot view.
    expect(json.cells['tasks']['r_task'].base).toBe('deny')
    // 'overview' has no FEATURE_RESOURCE mapping, so the baseline is allow.
    expect(json.cells['overview']['r_task'].base).toBe('allow')
    // Plain admin is admin-level: allow even without a grant.
    expect(json.cells['tasks']['r_admin'].base).toBe('allow')
  })

  it('surfaces a role-level override row in the cell for that role only', async () => {
    seed({
      viewGrants: [],
      overrides: [{ subjectId: 'r_task', featureKey: 'time', effect: 'allow' }],
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as MatrixResponse

    expect(json.cells['time']['r_task']).toEqual({ base: 'deny', override: 'allow' })
    expect(json.cells['time']['r_pm'].override).toBeNull()
    expect(json.cells['tasks']['r_task'].override).toBeNull()
  })

  it('orders roles super_admin, admin, project_manager, task_handler, viewer and locks only super_admin', async () => {
    seed()

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as MatrixResponse

    expect(json.roles.map((r) => r.name)).toEqual([
      'super_admin',
      'admin',
      'project_manager',
      'task_handler',
      'viewer',
    ])
    expect(json.roles.map((r) => r.locked)).toEqual([true, false, false, false, false])

    // featureKeys only carries team-audience keys from the real FEATURE_TREE.
    expect(json.featureKeys).toContain('tasks')
    expect(json.featureKeys).toContain('settings.permissions')
    expect(json.featureKeys).not.toContain('files')
    expect(json.featureKeys).not.toContain('services')
  })
})
