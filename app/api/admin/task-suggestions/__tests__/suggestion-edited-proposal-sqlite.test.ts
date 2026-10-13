import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { is } from 'drizzle-orm'
import { SQLiteTable, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { decideSuggestion } from '@/lib/task-suggestions'
import { createTaskRecord, updateTaskRecord } from '@/lib/task-writes'
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
    { orgId: orgB }, { orgId: null }, { requestId: 'request-b' },
  ])('refuses identity override %j without writes even with force', async links => {
    seedSuggestion()
    const initial = snapshot()
    expect((await approve({ title: 'Edited title', ...links })).status).toBe(400)
    expect(snapshot()).toEqual(initial)
    expect(fixture.queries.filter(query => /^(insert|update|delete)\b/i.test(query))).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it('allows adding a request link from the suggestion client without a proposal orgId', async () => {
    seedSuggestion()
    const response = await approve({ title: 'Linked client task', requestId: 'request-a' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ changed: true, suggestion: { status: 'applied' } })
    expect(fixture.rows(schema.tasks).find(row => row.title === 'Linked client task'))
      .toMatchObject({ org_id: orgA, request_id: 'request-a' })
  })

  it('allows changing to another request belonging to the suggestion client', async () => {
    fixture.insert(schema.requests, { id: 'request-a2', org_id: orgA, title: 'Another request', status: 'submitted' })
    seedSuggestion('create_task', { title: 'Original task', requestId: 'request-a' })
    const response = await approve({ title: 'Relinked client task', requestId: 'request-a2' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ changed: true, suggestion: { status: 'applied' } })
    expect(fixture.rows(schema.tasks).find(row => row.title === 'Relinked client task'))
      .toMatchObject({ org_id: orgA, request_id: 'request-a2' })
  })

  it.each([{ trackId: 'track-b' }, { scheduleRowId: 'row-b' }])('refuses a Tweak carrying a delivery link %j before writes', async link => {
    seedSuggestion('update_task', { fields: { title: 'Original' } })
    const initial = snapshot()
    expect((await approve({ fields: { title: 'Changed', ...link } })).status).toBe(400)
    expect(snapshot()).toEqual(initial)
    expect(fixture.queries.filter(query => /^(insert|update|delete)\b/i.test(query))).toEqual([])
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

  it.each(['trackId', 'scheduleRowId'])('drops model %s fields outside the task update allowlist', async field => {
    seedSuggestion('update_task', { fields: { title: 'Safe update', [field]: 'foreign', type: 'tahi_internal', tags: '["foreign"]', position: 99 } })
    const result = await decideSuggestion(fixture.database, 'suggestion', { action: 'approve' }, { actorId: 'scoped', via: 'dashboard' })
    expect(result?.suggestion.status).toBe('applied')
    expect(fixture.rows(schema.tasks)[0]).toMatchObject({ title: 'Safe update', type: 'client_task', track_id: null, schedule_row_id: null, tags: null, position: null })
  })

  it('refuses a contact assignee while allowing a team member assignee', async () => {
    fixture.insert(schema.contacts, { id: 'contact-a', org_id: orgA, name: 'Client contact' })
    seedSuggestion('update_task', { fields: { assigneeId: 'contact-a' } })
    const response = await approve({ fields: { assigneeId: 'contact-a' } })
    await expect(response.json()).resolves.toMatchObject({ suggestion: { status: 'failed', applyError: 'Task assignees must be team members' } })
    expect(fixture.rows(schema.tasks)[0].assignee_id).toBeNull()
    fixture.sqlite.prepare("UPDATE task_suggestions SET status = 'pending' WHERE id = 'suggestion'").run()
    const assigned = await approve({ fields: { assigneeId: 'tm-scoped' } })
    await expect(assigned.json()).resolves.toMatchObject({ suggestion: { status: 'applied' } })
    expect(fixture.rows(schema.tasks)[0]).toMatchObject({ assignee_id: 'tm-scoped', assignee_type: 'team_member' })
  })

  it.each(['create', 'update'])('guards the %s task writer against foreign track and schedule clients', async operation => {
    fixture.insert(schema.subscriptions, { id: 'subscription-b', org_id: orgB })
    fixture.insert(schema.tracks, { id: 'track-b', subscription_id: 'subscription-b' })
    fixture.insert(schema.deals, { id: 'deal-b', org_id: orgB })
    fixture.insert(schema.projectSchedules, { id: 'schedule-b', org_id: null, deal_id: 'deal-b' })
    fixture.insert(schema.scheduleRows, { id: 'row-b', schedule_id: 'schedule-b' })
    const initial = snapshot()
    const actor = { actorType: 'team_member' as const, actorId: 'scoped' }
    for (const link of [{ trackId: 'track-b' }, { scheduleRowId: 'row-b' }]) {
      const result = operation === 'create'
        ? await createTaskRecord(fixture.database, { title: 'Foreign delivery task', orgId: orgA, ...link }, actor)
        : await updateTaskRecord(fixture.database, 'task-a', link, actor)
      expect(result).toMatchObject({ ok: false, failure: { status: 400, error: expect.stringContaining('task client') } })
    }
    expect(snapshot()).toEqual(initial)
    expect(fixture.queries.filter(query => /^(insert|update|delete)\b/i.test(query))).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it('accepts delivery links for the task client using the schedule org before its deal org', async () => {
    fixture.insert(schema.subscriptions, { id: 'subscription-a', org_id: orgA })
    fixture.insert(schema.tracks, { id: 'track-a', subscription_id: 'subscription-a' })
    fixture.insert(schema.deals, { id: 'deal-b', org_id: orgB })
    fixture.insert(schema.projectSchedules, { id: 'schedule-a', org_id: orgA, deal_id: 'deal-b' })
    fixture.insert(schema.scheduleRows, { id: 'row-a', schedule_id: 'schedule-a' })
    expect(await updateTaskRecord(fixture.database, 'task-a', { trackId: 'track-a', scheduleRowId: 'row-a' },
      { actorType: 'team_member', actorId: 'scoped' })).toMatchObject({ ok: true })
    expect(fixture.rows(schema.tasks)[0]).toMatchObject({ track_id: 'track-a', schedule_row_id: 'row-a' })
    expect(fixture.errors).toEqual([])
  })

  it.each(['track_id', 'schedule_row_id'])('refuses moving a task whose retained %s belongs to its original client', async column => {
    fixture.insert(schema.subscriptions, { id: 'subscription-a', org_id: orgA })
    fixture.insert(schema.tracks, { id: 'track-a', subscription_id: 'subscription-a' })
    fixture.insert(schema.projectSchedules, { id: 'schedule-a', org_id: orgA })
    fixture.insert(schema.scheduleRows, { id: 'row-a', schedule_id: 'schedule-a' })
    fixture.sqlite.prepare(`UPDATE tasks SET ${column} = ? WHERE id = 'task-a'`).run(column === 'track_id' ? 'track-a' : 'row-a')
    const initial = snapshot()
    expect(await updateTaskRecord(fixture.database, 'task-a', { orgId: orgB },
      { actorType: 'system', actorId: 'scoped' })).toMatchObject({ ok: false, failure: { status: 400 } })
    expect(snapshot()).toEqual(initial)
    expect(fixture.queries.filter(query => /^(insert|update|delete)\b/i.test(query))).toEqual([])
    expect(fixture.errors).toEqual([])
  })
})
