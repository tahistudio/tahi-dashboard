import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { is } from 'drizzle-orm'
import { SQLiteTable, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { decideSuggestion } from '@/lib/task-suggestions'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'tahi-org',
}))
vi.mock('@/lib/task-comments', () => ({ postTaskComment: vi.fn(), postRequestBotMessage: vi.fn() }))
vi.mock('@/lib/slack/api', () => ({ slackBotToken: () => '' }))

import { POST } from '../[id]/decide/route'

let fixture: ReturnType<typeof permissionSqlite>
const at = '2026-10-13T00:00:00Z'
const orgA = 'org-a'
const orgB = 'org-b'

function seedSuggestion(kind = 'create_task', proposal: unknown = { title: 'Review the client identity' }) {
  fixture.insert(schema.taskSuggestions, {
    id: 'suggestion', org_id: orgA, kind, proposal: JSON.stringify(proposal),
    target_task_id: kind === 'update_task' ? 'task-a' : null,
    quote: 'Please review the client identity', status: 'pending',
    dedupe_key: 'suggestion', created_at: at, updated_at: at,
  })
}
function approve(proposal: unknown) {
  return POST(new NextRequest('http://localhost/api/admin/task-suggestions/suggestion/decide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve', proposal, force: true }),
  }), { params: Promise.resolve({ id: 'suggestion' }) })
}
function snapshot() {
  return [fixture.rows(schema.tasks), fixture.rows(schema.requests), fixture.rows(schema.taskSuggestions)]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'tahi-org')
  const tables: AnySQLiteTable[] = []
  for (const value of Object.values(schema)) if (is(value, SQLiteTable)) tables.push(value)
  fixture = permissionSqlite(tables)
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'scoped', orgId: 'tahi-org', sessionId: 'verified' })
  fixture.insert(schema.teamMembers, { id: 'tm-scoped', clerk_user_id: 'scoped', role: 'member' })
  fixture.insert(schema.roles, { id: 'designer', name: 'designer' })
  fixture.insert(schema.teamMemberRoles, { id: 'grant', team_member_id: 'tm-scoped', role_id: 'designer', ended_at: null })
  for (const resource of ['tasks', 'requests']) {
    fixture.insert(schema.permissions, { id: resource, resource, action: 'view' })
    fixture.insert(schema.rolePermissions, { id: resource, role_id: 'designer', permission_id: resource })
  }
  fixture.insert(schema.teamMemberAccess, { id: 'scope', team_member_id: 'tm-scoped', scope_type: 'specific_clients' })
  fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'scope', org_id: orgA })
  for (const orgId of [orgA, orgB]) fixture.insert(schema.organisations, { id: orgId, name: orgId })
  for (const [id, orgId] of [['request-a', orgA], ['request-b', orgB]]) {
    fixture.insert(schema.requests, { id, org_id: orgId, title: id, status: 'submitted' })
  }
  fixture.insert(schema.tasks, {
    id: 'task-a', org_id: orgA, request_id: 'request-a', type: 'client_task',
    title: 'Existing client task', status: 'todo', priority: 'normal', created_at: at, updated_at: at,
  })
})
afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

describe('edited proposal isolation over real SQLite', () => {
  it.each([
    { orgId: orgB }, { orgId: null }, { requestId: 'request-b' }, { requestId: 'request-a' },
  ])('refuses identity override %j without writes even with force', async links => {
    seedSuggestion()
    const initial = snapshot()
    expect((await approve({ title: 'Edited title', ...links })).status).toBe(400)
    expect(snapshot()).toEqual(initial)
    expect(fixture.queries.filter(query => /^(insert|update|delete)\b/i.test(query))).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it('allows title edits that restate the existing client and request', async () => {
    seedSuggestion('create_task', { title: 'Original task', requestId: 'request-a' })
    const response = await approve({ title: 'Edited task', orgId: orgA, requestId: 'request-a' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ changed: true, suggestion: { status: 'applied' } })
    expect(fixture.rows(schema.tasks).find(row => row.title === 'Edited task')).toMatchObject({ org_id: orgA, request_id: 'request-a' })
    expect(fixture.errors).toEqual([])
  })

  it('refuses an edited proposal that drops its original request link', async () => {
    seedSuggestion('create_task', { title: 'Original task', requestId: 'request-a' })
    const initial = snapshot()
    expect((await approve({ title: 'Edited task' })).status).toBe(400)
    expect(snapshot()).toEqual(initial)
  })

  it('also rejects edited identity through the shared decision library', async () => {
    seedSuggestion()
    const initial = snapshot()
    expect(await decideSuggestion(fixture.database, 'suggestion', {
      action: 'approve', force: true, proposalOverride: { title: 'Foreign task', orgId: orgB },
    }, { actorId: 'scoped', via: 'slack' })).toMatchObject({ changed: false, error: expect.stringContaining('client') })
    expect(snapshot()).toEqual(initial)
  })

  it.each([false, true])('strips task reassignment fields for edited=%s while applying permitted fields', async edited => {
    const proposal = { fields: { title: 'Reviewed task', orgId: orgB, requestId: 'request-b' } }
    seedSuggestion('update_task', edited ? { fields: { title: 'Original' } } : proposal)
    const response = edited
      ? await approve(proposal)
      : await POST(new NextRequest('http://localhost/api/admin/task-suggestions/suggestion/decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }),
      }), { params: Promise.resolve({ id: 'suggestion' }) })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ changed: true, suggestion: { status: 'applied' } })
    expect(fixture.rows(schema.tasks)).toEqual([expect.objectContaining({
      id: 'task-a', org_id: orgA, request_id: 'request-a', title: 'Reviewed task',
    })])
    expect(fixture.rows(schema.requests).find(row => row.id === 'request-b')).toMatchObject({ org_id: orgB, title: 'request-b' })
    expect(fixture.errors).toEqual([])
  })
})
