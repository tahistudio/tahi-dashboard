import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  resolvePermissions: vi.fn(),
}))
vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: vi.fn() }))

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth } from '@/lib/server-auth'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { resolveAccessScoping } from '@/lib/access-scoping'
import {
  countSuggestions, listSuggestions,
  type DecoratedSuggestion, type SuggestionCounts, type SuggestionKind, type SuggestionStatus,
} from '@/lib/task-suggestions'
import { GET } from '../route'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const CREATED = '2026-10-11T00:00:00.000Z'
const STUDIO_PENDING = ['studio-create', 'studio-note']
const A_PENDING = [...STUDIO_PENDING, 'a-create']
const ALL_PENDING = [...A_PENDING, 'b-create']
const ZERO_COUNTS = { pending: 0, snoozed: 0, calls: 0 }
const A_COUNTS = { pending: 3, snoozed: 2, calls: 2 }
const ALL_COUNTS = { pending: 4, snoozed: 2, calls: 3 }
let fixture: ReturnType<typeof permissionSqlite>

interface InboxBody {
  items: DecoratedSuggestion[]
  counts: SuggestionCounts
}

function seedSuggestion(
  id: string, orgId: string | null, status: SuggestionStatus,
  kind: SuggestionKind, title: string, callId: string,
) {
  fixture.insert(schema.taskSuggestions, {
    id, org_id: orgId, source_kind: 'call', call_kind: 'scheduled', call_id: callId,
    kind, proposal: JSON.stringify({ title }), quote: `Private quote for ${id}`,
    status, approver_type: 'founders', dedupe_key: id, created_at: CREATED, updated_at: CREATED,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture = permissionSqlite([
    schema.taskSuggestions, schema.organisations, schema.tasks, schema.requests, schema.scheduledCalls,
  ])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi', sessionId: 'session-1' })
  const access: ResolvedAccess = {
    userId: 'user_member', orgId: 'org_tahi', level: 'team_member', audience: 'team',
    isSuperAdmin: false, isAdmin: false, canManagePermissions: false,
    viewableResources: new Set(['tasks', 'requests']), overrides: new Map(),
  }
  vi.mocked(resolvePermissions).mockResolvedValue(access)
  vi.mocked(resolveAccessScoping).mockResolvedValue([])

  for (const id of [ORG_A, ORG_B]) fixture.insert(schema.organisations, { id, name: id })
  for (const [id, orgId] of [
    ['call-studio', null], ['call-snoozed', null], ['call-a', ORG_A], ['call-b', ORG_B],
  ] as const) fixture.insert(schema.scheduledCalls, {
    id, org_id: orgId, title: id, scheduled_at: CREATED,
  })
  seedSuggestion('studio-create', null, 'pending', 'create_task', 'Renew studio domain', 'call-studio')
  seedSuggestion('studio-note', null, 'pending', 'note', 'Private founder note', 'call-studio')
  seedSuggestion('studio-snoozed', null, 'snoozed', 'note', 'Private deferred note', 'call-snoozed')
  seedSuggestion('a-create', ORG_A, 'pending', 'create_request', 'Refresh client homepage', 'call-a')
  seedSuggestion('a-snoozed', ORG_A, 'snoozed', 'request_note', 'Deferred client note', 'call-a')
  seedSuggestion('b-create', ORG_B, 'pending', 'create_request', 'Refresh client homepage', 'call-b')
  seedSuggestion('b-rejected', ORG_B, 'rejected', 'request_note', 'Rejected private note', 'call-b')
  fixture.insert(schema.tasks, {
    id: 'studio-task', org_id: null, title: 'Renew studio domain', status: 'todo', updated_at: CREATED,
  })
  for (const [id, orgId] of [['request-a', ORG_A], ['request-b', ORG_B]] as const) {
    fixture.insert(schema.requests, {
      id, org_id: orgId, title: 'Refresh client homepage', status: 'submitted', updated_at: CREATED,
    })
  }
})

afterEach(() => { fixture.close() })

describe('suggestion scope over real SQLite', () => {
  it('returns no list rows or counts for an empty scope before any business SQL', async () => {
    expect(fixture.rows(schema.taskSuggestions)).toHaveLength(7)
    expect(await listSuggestions(fixture.database, { orgIds: [], status: 'all' })).toEqual([])
    expect(await countSuggestions(fixture.database, { orgIds: [] })).toEqual(ZERO_COUNTS)
    expect(fixture.queries).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it.each(['', '?status=all&callId=call-studio&limit=200'])(
    'GET returns no private rows, duplicate context or counts for an empty scope (%s)', async query => {
      const response = await GET(new NextRequest(`http://localhost/api/admin/task-suggestions${query}`))
      const body: InboxBody = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ items: [], counts: ZERO_COUNTS })
      expect(resolvePermissions).toHaveBeenCalled()
      expect(resolveAccessScoping).toHaveBeenCalledWith(fixture.database, 'user_member')
      expect(fixture.queries).toEqual([])
      expect(fixture.errors).toEqual([])
    },
  )

  it('keeps permitted client and studio rows, counts and scoped duplicate context for a nonempty scope', async () => {
    const items = await listSuggestions(fixture.database, { orgIds: [ORG_A], status: 'pending' })

    expect(items.map(item => item.id).sort()).toEqual([...A_PENDING].sort())
    expect(await countSuggestions(fixture.database, { orgIds: [ORG_A] })).toEqual(A_COUNTS)
    expect(items.find(item => item.id === 'a-create')).toMatchObject({
      orgName: ORG_A, callTitle: 'call-a', similar: [expect.objectContaining({ id: 'request-a' })],
    })
    expect(items.find(item => item.id === 'studio-create')?.similar).toEqual([
      expect.objectContaining({ id: 'studio-task' }),
    ])
    expect(fixture.queries.length).toBeGreaterThan(0)
    expect(fixture.errors).toEqual([])
  })

  it('keeps studio rows for a nonempty scope without matching client rows', async () => {
    const orgIds = ['another-granted-client']
    const items = await listSuggestions(fixture.database, { orgIds, status: 'pending' })

    expect(items.map(item => item.id).sort()).toEqual([...STUDIO_PENDING].sort())
    expect(await countSuggestions(fixture.database, { orgIds })).toEqual({ pending: 2, snoozed: 1, calls: 1 })
    expect(fixture.errors).toEqual([])
  })

  it.each(['all', undefined] as const)('keeps unrestricted list and count behavior for orgIds %s', async orgIds => {
    const items = await listSuggestions(fixture.database, { orgIds, status: 'pending' })

    expect(items.map(item => item.id).sort()).toEqual([...ALL_PENDING].sort())
    expect(await countSuggestions(fixture.database, { orgIds })).toEqual(ALL_COUNTS)
    expect(await countSuggestions(fixture.database)).toEqual(ALL_COUNTS)
    expect(fixture.errors).toEqual([])
  })

  it.each([
    { name: 'nonempty', scope: [ORG_A], ids: A_PENDING, counts: A_COUNTS },
    { name: 'unrestricted', scope: null, ids: ALL_PENDING, counts: ALL_COUNTS },
  ])('GET keeps $name results and immediately hides them when access becomes empty', async ({ scope, ids, counts }) => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(scope)
    const request = new NextRequest('http://localhost/api/admin/task-suggestions')
    const permitted = await GET(request)
    const body: InboxBody = await permitted.json()

    expect(permitted.status).toBe(200)
    expect(body.items.map(item => item.id).sort()).toEqual([...ids].sort())
    expect(body.counts).toEqual(counts)
    expect(fixture.queries.length).toBeGreaterThan(0)
    fixture.queries.length = 0
    vi.mocked(resolveAccessScoping).mockResolvedValue([])

    const denied = await GET(request)
    const deniedBody: InboxBody = await denied.json()
    expect(denied.status).toBe(200)
    expect(deniedBody).toEqual({ items: [], counts: ZERO_COUNTS })
    expect(fixture.queries).toEqual([])
    expect(fixture.errors).toEqual([])
  })
})
