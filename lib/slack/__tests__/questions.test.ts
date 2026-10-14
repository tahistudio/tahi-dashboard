import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'
import { schema } from '@/db/d1'
import { answerSlackQuestion, MAX_QUESTION_ITEMS, questionDateWindow } from '../questions'
import { SLACK_DENIED_REPLY, type SlackIdentity } from '../identity'
import type { SlackQuestionIntent } from '../intents'

let fixture: ReturnType<typeof permissionSqlite>
const NOW = new Date('2026-10-13T22:00:00Z')
const MEMBER: SlackIdentity = {
  id: 'si_reader', slackTeamId: 'T1', slackUserId: 'U1', email: 'reader@tahi.studio', level: 'member',
  teamMemberId: 'reader', contactId: null, orgId: null, dmChannelId: 'D1',
}
const INTENTS: SlackQuestionIntent[] = ['work_today', 'waiting_on_me', 'due_today', 'due_week', 'overdue', 'my_tasks', 'approvals']

function task(id: string, values: Record<string, string | null> = {}) {
  fixture.insert(schema.tasks, {
    id, type: 'internal_client_task', title: id, org_id: 'org_a', status: 'todo',
    assignee_id: 'reader', assignee_type: 'team_member', due_date: '2026-10-14', ...values,
  })
}

function request(id: string, values: Record<string, string | number | null> = {}) {
  fixture.insert(schema.requests, {
    id, title: id, org_id: 'org_a', status: 'in_progress', assignee_id: 'reader',
    due_date: '2026-10-14', is_internal: 0, waiting_on_contact_id: null, ...values,
  })
}

function suggestion(id: string, values: Record<string, string | null> = {}) {
  fixture.insert(schema.taskSuggestions, {
    id, org_id: 'org_a', source_kind: 'note', kind: 'create_task',
    proposal: JSON.stringify({ title: id }), status: 'pending', approver_type: 'member', approver_id: 'reader',
    created_at: NOW.toISOString(), ...values,
  })
}

function answer(intent: SlackQuestionIntent, identity = MEMBER) {
  return answerSlackQuestion({ database: fixture.database, identity, intent, now: NOW })
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'tahi')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.tahi.studio')
  fixture = permissionSqlite([
    schema.teamMembers, schema.teamMemberRoles, schema.roles, schema.permissions, schema.rolePermissions,
    schema.teamMemberAccess, schema.teamMemberAccessOrgs, schema.featureVisibility, schema.organisations,
    schema.tasks, schema.requests, schema.requestParticipants, schema.taskSuggestions, schema.contacts, schema.brandContacts,
  ])
  fixture.insert(schema.organisations, { id: 'org_a', name: 'Allowed' })
  fixture.insert(schema.organisations, { id: 'org_b', name: 'Denied' })
  fixture.insert(schema.teamMembers, { id: 'reader', name: 'Reader', clerk_user_id: 'user_reader', role: 'member' })
  fixture.insert(schema.roles, { id: 'member_role', name: 'task_handler' })
  fixture.insert(schema.roles, { id: 'founder_role', name: 'super_admin' })
  fixture.insert(schema.teamMemberRoles, { id: 'role_link', team_member_id: 'reader', role_id: 'member_role', ended_at: null })
  for (const feature of ['tasks', 'requests']) {
    fixture.insert(schema.permissions, { id: feature, resource: feature, action: 'view' })
    fixture.insert(schema.rolePermissions, { id: feature, role_id: 'member_role', permission_id: feature })
  }
  fixture.insert(schema.teamMemberAccess, { id: 'access', team_member_id: 'reader', scope_type: 'specific_clients' })
  fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'access', org_id: 'org_a' })
  task('MY_OVERDUE', { due_date: '2026-10-13' })
  task('MY_TODAY')
  task('MY_WEEK', { due_date: '2026-10-16' })
  task('MY_LATER', { due_date: '2026-10-20' })
  task('OTHER_PRIVATE_TASK', { assignee_id: 'other' })
  task('DENIED_PRIVATE_TASK', { org_id: 'org_b' })
  task('CLOSED_PRIVATE_TASK', { status: 'done' })
  request('MY_REQUEST')
  request('PARTICIPANT_REQUEST', { assignee_id: 'other' })
  fixture.insert(schema.requestParticipants, { id: 'rp1', request_id: 'PARTICIPANT_REQUEST', participant_id: 'reader', participant_type: 'team_member', role: 'assignee', removed_at: null })
  request('OTHER_PRIVATE_REQUEST', { assignee_id: 'other' })
  request('DENIED_PRIVATE_REQUEST', { org_id: 'org_b' })
  request('CLIENT_WAITING_REQUEST', { waiting_on_contact_id: 'client' })
  suggestion('MY_APPROVAL')
  suggestion('OTHER_PRIVATE_APPROVAL', { approver_id: 'other' })
  suggestion('DENIED_PRIVATE_APPROVAL', { org_id: 'org_b' })
  suggestion('FOUNDERS_APPROVAL', { approver_type: 'founders', approver_id: null })
  suggestion('CONTACT_PRIVATE_APPROVAL', { approver_type: 'contact', approver_id: 'client' })
})

afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

describe('read-only Slack answers and scoping', () => {
  it.each(INTENTS)('%s shows no other sender or forbidden client data', async intent => {
    const text = await answer(intent)
    expect(text).not.toBe(SLACK_DENIED_REPLY)
    expect(text).not.toContain('PRIVATE')
    expect(text).not.toContain('FOUNDERS_APPROVAL')
    expect(text).toContain('|See all>')
    expect(fixture.errors).toEqual([])
    expect(fixture.queries.filter(query => /^(insert|update|delete) /i.test(query))).toEqual([])
  })

  it.each(INTENTS)('%s refuses strangers before any data read', async intent => {
    const count = fixture.queries.length
    expect(await answer(intent, { ...MEMBER, level: 'unknown', teamMemberId: null })).toBe(SLACK_DENIED_REPLY)
    expect(fixture.queries).toHaveLength(count)
  })

  it('sorts open tasks overdue first and includes own requests and approvals', async () => {
    const text = await answer('work_today')
    expect(text.indexOf('MY_OVERDUE')).toBeLessThan(text.indexOf('MY_TODAY'))
    expect(text).toContain('MY_REQUEST')
    expect(text).toContain('PARTICIPANT_REQUEST')
    expect(text).toContain('MY_APPROVAL')
    expect(text).not.toContain('CLIENT_WAITING_REQUEST')
    expect(text).toContain('https://portal.tahi.studio/tasks?task=MY_TODAY')
  })

  it.each([
    ['due_today', ['MY_TODAY', 'MY_REQUEST'], ['MY_OVERDUE', 'MY_WEEK', 'MY_LATER']],
    ['due_week', ['MY_TODAY', 'MY_WEEK'], ['MY_OVERDUE', 'MY_LATER']],
    ['overdue', ['MY_OVERDUE'], ['MY_TODAY', 'MY_WEEK', 'MY_LATER']],
    ['my_tasks', ['MY_OVERDUE', 'MY_TODAY'], ['MY_REQUEST', 'MY_APPROVAL']],
    ['approvals', ['MY_APPROVAL'], ['MY_TODAY', 'MY_REQUEST']],
  ] as const)('%s applies its date or item filter', async (intent, included, excluded) => {
    const text = await answer(intent)
    for (const title of included) expect(text).toContain(title)
    for (const title of excluded) expect(text).not.toContain(title)
  })

  it('includes studio waiting and call approvals only for a current founder', async () => {
    await fixture.database.update(schema.teamMemberRoles).set({ roleId: 'founder_role' }).where(eq(schema.teamMemberRoles.id, 'role_link'))
    expect(await answer('waiting_on_me', { ...MEMBER, level: 'founder' })).toContain('Waiting on studio')
    expect(await answer('approvals', { ...MEMBER, level: 'founder' })).toContain('FOUNDERS_APPROVAL')
    expect(await answer('approvals', { ...MEMBER, level: 'founder' })).not.toContain('CONTACT_PRIVATE_APPROVAL')
    await fixture.database.update(schema.teamMemberRoles).set({ roleId: 'member_role' }).where(eq(schema.teamMemberRoles.id, 'role_link'))
    expect(await answer('waiting_on_me', { ...MEMBER, level: 'founder' })).not.toContain('OTHER_PRIVATE_REQUEST')
  })

  it('revokes reads with the active role, organisation scope or feature', async () => {
    fixture.insert(schema.featureVisibility, { id: 'deny', subject_type: 'team_member', subject_id: 'reader', feature_key: 'tasks', effect: 'deny' })
    expect(await answer('my_tasks')).not.toContain('MY_TODAY')
    await fixture.database.update(schema.teamMemberRoles).set({ endedAt: NOW.toISOString() }).where(eq(schema.teamMemberRoles.id, 'role_link'))
    expect(await answer('work_today', { ...MEMBER, level: 'founder' })).toBe(SLACK_DENIED_REPLY)
  })

  it('denies studio housekeeping too when the sender has no organisation access', async () => {
    task('MY_STUDIO_TASK', { org_id: null })
    await fixture.database.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, 'access'))
    expect(await answer('my_tasks')).toBe(SLACK_DENIED_REPLY)
  })

  it('never links a request-only member to the denied Tasks approval inbox', async () => {
    fixture.insert(schema.featureVisibility, { id: 'deny_tasks', subject_type: 'team_member', subject_id: 'reader', feature_key: 'tasks', effect: 'deny' })
    suggestion('MY_REQUEST_APPROVAL', { kind: 'create_request' })
    const text = await answer('work_today')
    expect(text).toContain('MY_REQUEST')
    expect(text).not.toContain('MY_REQUEST_APPROVAL')
    expect(text).not.toContain('/tasks')
    expect(await answer('approvals')).toBe(SLACK_DENIED_REPLY)
    expect(await answer('my_tasks')).toBe(SLACK_DENIED_REPLY)
  })

  it('limits replies to eight linked items', async () => {
    for (let index = 0; index < 12; index += 1) task(`MORE_${index}`)
    const text = await answer('my_tasks')
    expect(text.split('\n').filter(line => line.startsWith('• '))).toHaveLength(MAX_QUESTION_ITEMS)
    expect(text).toContain('/tasks|See all>')
  })

  it('uses Auckland dates and the Sunday week boundary', () => {
    expect(questionDateWindow(new Date('2026-10-13T12:30:00Z'))).toEqual({ today: '2026-10-14', weekEnd: '2026-10-18' })
    expect(questionDateWindow(new Date('2026-09-26T13:00:00Z'))).toEqual({ today: '2026-09-27', weekEnd: '2026-09-27' })
  })

  it('accepts ISO due dates and tolerates a malformed stored due date', async () => {
    task('ISO_DUE_TODAY', { due_date: '2026-10-14T00:00:00Z' })
    task('BAD_DATE', { due_date: 'invalid' })
    expect(await answer('due_today')).toContain('ISO_DUE_TODAY')
    expect(await answer('my_tasks')).toContain('Due date needs review')
  })

  it('places an empty due date after dated work and never calls it overdue', async () => {
    task('UNDATED', { due_date: '' })
    expect(await answer('overdue')).not.toContain('UNDATED')
    const text = await answer('my_tasks')
    expect(text.indexOf('MY_LATER')).toBeLessThan(text.indexOf('UNDATED'))
  })
})

describe('client request status questions', () => {
  const client: SlackIdentity = { ...MEMBER, level: 'client', teamMemberId: null, contactId: 'client', orgId: 'org_a' }

  beforeEach(() => {
    fixture.insert(schema.contacts, { id: 'client', org_id: 'org_a', name: 'Client', portal_role: 'member', is_primary: 0 })
    request('OWN_CLIENT_REQUEST', { submitted_by_id: 'client', submitted_by_type: 'contact', brand_id: 'brand_a' })
    request('OWN_WAITING_REQUEST', { waiting_on_contact_id: 'client', waiting_reason: 'approval', brand_id: 'brand_a' })
    request('INTERNAL_PRIVATE_REQUEST', { submitted_by_id: 'client', submitted_by_type: 'contact', is_internal: 1 })
    request('OTHER_ORG_PRIVATE_REQUEST', { org_id: 'org_b', submitted_by_id: 'client', submitted_by_type: 'contact' })
  })

  it.each(INTENTS)('%s never shows studio work or colleagues requests', async intent => {
    const text = await answer(intent, client)
    expect(text).not.toBe(SLACK_DENIED_REPLY)
    expect(text).not.toMatch(/PRIVATE|MY_TODAY|MY_APPROVAL|MY_REQUEST|PARTICIPANT_REQUEST/)
    expect(text).toContain('/requests|See all>')
    expect(fixture.errors).toEqual([])
  })

  it('reports only their request status and own approval hand-offs', async () => {
    expect(await answer('work_today', client)).toContain('OWN_CLIENT_REQUEST')
    const text = await answer('approvals', client)
    expect(text).toContain('OWN_WAITING_REQUEST')
    expect(text).not.toContain('OWN_CLIENT_REQUEST')
  })

  it('includes the clients own approved Slack request without exposing studio suggestions', async () => {
    request('OWN_SLACK_REQUEST', { submitted_by_id: 'studio_actor', submitted_by_type: 'team_member' })
    suggestion('OWN_SLACK_DRAFT', {
      approver_type: 'contact', approver_id: 'client', kind: 'create_request', status: 'applied', applied_request_id: 'OWN_SLACK_REQUEST',
    })
    const text = await answer('work_today', client)
    expect(text).toContain('OWN_SLACK_REQUEST')
    expect(text).not.toContain('OWN_SLACK_DRAFT')
  })

  it('keeps the portal brand scope and Requests feature denial', async () => {
    fixture.insert(schema.brandContacts, { id: 'brand_link', contact_id: 'client', brand_id: 'brand_other' })
    expect(await answer('work_today', client)).not.toContain('OWN_CLIENT_REQUEST')
    fixture.insert(schema.featureVisibility, { id: 'deny_client', subject_type: 'contact', subject_id: 'client', feature_key: 'requests', effect: 'deny' })
    expect(await answer('work_today', client)).toBe(SLACK_DENIED_REPLY)
  })
})
