import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
const model = vi.hoisted(() => ({ suggest: vi.fn() }))
// Only model inference is replaced. Authorization, context, suggestion writes,
// snooze resurfacing, org repair and cron logging all execute real SQLite SQL.
vi.mock('@/lib/task-suggester', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/task-suggester')>()
  return {
    ...actual,
    runSuggestionSweep: vi.fn((database, options) => actual.runSuggestionSweep(database, {
      ...options, suggest: model.suggest,
    })),
  }
})

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { runSuggestionSweep } from '@/lib/task-suggester'
import { POST } from '@/app/api/admin/crons/suggest-from-transcripts/route'

const NOW = new Date().toISOString()
const PAST = '2026-01-01T00:00:00Z'
let fixture: ReturnType<typeof permissionSqlite>

interface Scenario {
  role?: 'member' | 'admin' | 'ended' | 'none'
  scope?: 'all' | 'specific' | 'none'
  deny?: 'tasks' | 'requests'
  missingIdentity?: boolean
}

function seed({ role = 'member', scope = 'all', deny, missingIdentity }: Scenario = {}) {
  fixture.insert(schema.roles, { id: 'role-admin', name: 'admin' })
  fixture.insert(schema.roles, { id: 'role-member', name: 'task_handler' })
  // Keep the workspace seeded so a missing grant cannot use bootstrap access.
  fixture.insert(schema.teamMemberRoles, {
    id: 'keeper', team_member_id: 'tm-keeper', role_id: 'role-admin', ended_at: null,
  })
  if (!missingIdentity) fixture.insert(schema.teamMembers, {
    id: 'tm-reader', clerk_user_id: 'user_reader', name: 'Reader', role: 'admin',
  })
  if (role !== 'none') fixture.insert(schema.teamMemberRoles, {
    id: 'reader', team_member_id: 'tm-reader',
    role_id: role === 'admin' || role === 'ended' ? 'role-admin' : 'role-member',
    ended_at: role === 'ended' ? PAST : null,
  })
  for (const feature of ['tasks', 'requests']) {
    fixture.insert(schema.permissions, { id: feature, resource: feature, action: 'view' })
    fixture.insert(schema.rolePermissions, { id: feature, role_id: 'role-member', permission_id: feature })
  }
  if (deny) fixture.insert(schema.featureVisibility, {
    id: 'deny', subject_type: 'team_member', subject_id: 'tm-reader', feature_key: deny, effect: 'deny',
  })
  if (scope !== 'none') fixture.insert(schema.teamMemberAccess, {
    id: 'access', team_member_id: 'tm-reader', scope_type: scope === 'all' ? 'all_clients' : 'specific_clients',
  })
  if (scope === 'specific') fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'access', org_id: 'org-a' })
  for (const id of ['org-a', 'org-b']) fixture.insert(schema.organisations, { id, name: id })
  fixture.insert(schema.scheduledCalls, { id: 'call-b', org_id: 'org-b', title: 'Foreign call' })
  fixture.insert(schema.callTranscripts, {
    id: 'transcript-b', call_kind: 'scheduled', call_id: 'call-b', source: 'manual',
    external_id: 'external-b', hash: 'hash-b', received_at: NOW, suggested_at: null,
    text: 'Create a fresh design direction.', title: 'Private client B transcript', wrap_up: null,
  })
  fixture.insert(schema.taskSuggestions, {
    id: 'snoozed-b', org_id: 'org-b', source_kind: 'call', kind: 'note', status: 'snoozed',
    proposal: JSON.stringify({ body: 'Private deferred B work' }), quote: 'Private B quote',
    snooze_until: PAST, dedupe_key: 'snoozed-b', created_at: PAST, updated_at: PAST,
  })
  fixture.insert(schema.taskSuggestions, {
    id: 'orgless-b', org_id: null, source_kind: 'call', call_kind: 'scheduled', call_id: 'call-b',
    kind: 'create_task', status: 'pending', proposal: JSON.stringify({ title: 'Existing B proposal' }),
    quote: 'Private B quote', dedupe_key: 'orgless-b', created_at: PAST, updated_at: PAST,
  })
}

function post(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/admin/crons/suggest-from-transcripts?second_pass=0', {
    method: 'POST', headers,
  })
}

function snapshot() {
  return [schema.callTranscripts, schema.taskSuggestions, schema.cronRuns].map(table => fixture.rows(table))
}

async function expectDenied(headers: Record<string, string> = {}, status = 403) {
  const before = snapshot()
  const start = fixture.queries.length
  const response = await POST(post(headers))
  expect(response.status).toBe(status)
  expect(snapshot()).toEqual(before)
  expect(fixture.queries.slice(start).filter(query => /^(insert|update|delete|replace)\b/i.test(query))).toEqual([])
  expect(fixture.queries.slice(start).filter(query => /from "(call_transcripts|task_suggestions)"/i.test(query))).toEqual([])
  expect(runSuggestionSweep).not.toHaveBeenCalled()
  expect(model.suggest).not.toHaveBeenCalled()
}

async function expectPermitted(headers: Record<string, string> = {}) {
  const response = await POST(post(headers))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ looked: 1, inserted: 1, resurfaced: 1, repaired: 1, slackDelivered: 0 })
  expect(fixture.rows(schema.callTranscripts)[0].suggested_at).not.toBeNull()
  const rows = fixture.rows(schema.taskSuggestions)
  expect(rows.find(row => row.id === 'snoozed-b')).toMatchObject({ status: 'pending', snooze_until: null })
  expect(rows.find(row => row.id === 'orgless-b')).toMatchObject({ org_id: 'org-b' })
  expect(rows.find(row => row.transcript_id === 'transcript-b')).toMatchObject({ org_id: 'org-b', status: 'pending' })
  expect(fixture.rows(schema.cronRuns)).toEqual([expect.objectContaining({ cron: 'suggest-from-transcripts', status: 'success' })])
  expect(fixture.errors).toEqual([])
  expect(model.suggest).toHaveBeenCalledOnce()
  expect(model.suggest.mock.calls[0][0]).toMatchObject({ timeoutMs: 30_000, signal: expect.any(AbortSignal) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.stubEnv('TAHI_CRON_SECRET', 'fixture-scheduler-secret')
  vi.stubEnv('CRON_SECRET', '')
  vi.stubEnv('SLACK_BOT_TOKEN', '')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External calls are forbidden in this fixture') }))
  fixture = permissionSqlite([
    schema.teamMembers, schema.roles, schema.teamMemberRoles, schema.permissions, schema.rolePermissions,
    schema.featureVisibility, schema.teamMemberAccess, schema.teamMemberAccessOrgs, schema.organisations,
    schema.callTranscripts, schema.meetingRecordings, schema.scheduledCalls, schema.taskSuggestions, schema.cronRuns,
    schema.tasks, schema.requests, schema.contacts,
  ])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_reader', orgId: 'org_tahi', sessionId: 'fixture' })
  model.suggest.mockResolvedValue({
    suggestions: [{ kind: 'create_task', targetTaskId: null, proposal: { title: 'Fresh design direction' }, quote: 'Create a fresh design direction.', confidence: 0.9 }],
    dropped: [], usage: { model: 'fixture', inputTokens: 0, outputTokens: 0 },
  })
})

afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('manual suggestion cron authorization over real SQLite', () => {
  it.each<[string, Scenario]>([
    ['roleless identity with stale all-client access', { role: 'none' }],
    ['ended admin role with legacy admin column', { role: 'ended' }],
    ['missing roster identity', { missingIdentity: true }],
    ['task feature denied', { deny: 'tasks' }],
    ['request feature denied', { deny: 'requests' }],
    ['specific-client scope', { scope: 'specific' }],
    ['zero-client scope', { scope: 'none' }],
  ])('refuses %s before transcript reads, global repairs or logging', async (_name, scenario) => {
    seed(scenario)
    await expectDenied()
  })

  it('does not bootstrap a roleless human when no active assignment remains', async () => {
    seed({ role: 'none' })
    await fixture.database.delete(schema.teamMemberRoles)
    await expectDenied()
  })

  it.each(['team_members', 'feature_visibility', 'team_member_access'])(
    'fails closed when %s lookup fails', async table => {
      seed()
      await fixture.database.run(sql.raw(`DROP TABLE ${table}`))
      await expectDenied()
      expect(fixture.errors.length).toBeGreaterThan(0)
    },
  )

  it('refuses a missing session identity', async () => {
    seed()
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: 'org_tahi', sessionId: null })
    await expectDenied({}, 401)
  })

  it('refuses a client session even with a matching roster identity', async () => {
    seed({ role: 'admin' })
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_reader', orgId: 'org-client', sessionId: 'fixture' })
    await expectDenied()
  })

  it('does not treat a manual user named system as the scheduler', async () => {
    seed()
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'system', orgId: 'org_tahi', sessionId: 'fixture' })
    await expectDenied()
  })

  it('does not bypass a denial for an invalid scheduler secret', async () => {
    seed({ deny: 'tasks' })
    await expectDenied({ 'x-cron-secret': 'wrong-secret' })
  })

  it.each<Scenario>([{ role: 'admin', scope: 'specific' }, { role: 'member', scope: 'all' }])(
    'runs for a currently permitted $role with unrestricted resolved scope', async scenario => {
      seed(scenario)
      await expectPermitted()
    },
  )

  it('honors role revocation on the next manual call', async () => {
    seed()
    await expectPermitted()
    await fixture.database.update(schema.teamMemberRoles).set({ endedAt: NOW }).where(eq(schema.teamMemberRoles.id, 'reader'))
    vi.clearAllMocks()
    await expectDenied()
  })

  it.each(['feature', 'scope'])('honors current %s revocation after a permitted run', async boundary => {
    seed()
    await expectPermitted()
    if (boundary === 'feature') fixture.insert(schema.featureVisibility, {
      id: 'revoked', subject_type: 'team_member', subject_id: 'tm-reader', feature_key: 'requests', effect: 'deny',
    })
    else {
      await fixture.database.update(schema.teamMemberAccess).set({ scopeType: 'specific_clients' })
        .where(eq(schema.teamMemberAccess.id, 'access'))
      fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'access', org_id: 'org-a' })
    }
    vi.clearAllMocks()
    await expectDenied()
  })

  it('retains the verified service identity without a roster row', async () => {
    seed({ missingIdentity: true })
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'api-service', orgId: 'org_tahi', sessionId: null })
    await expectPermitted()
  })

  it.each<Record<string, string>>([{ 'x-cron-secret': 'fixture-scheduler-secret' }, { authorization: 'Bearer fixture-scheduler-secret' }])(
    'preserves the verified scheduler path with %j', async headers => {
      seed({ missingIdentity: true, role: 'none', scope: 'none' })
      vi.mocked(getRequestAuth).mockRejectedValue(new Error('No human session is required by the scheduler'))
      await expectPermitted(headers)
      expect(getRequestAuth).not.toHaveBeenCalled()
    },
  )

  it('preserves the legacy configured scheduler-secret fallback', async () => {
    seed({ role: 'none' })
    vi.stubEnv('TAHI_CRON_SECRET', undefined)
    vi.stubEnv('CRON_SECRET', 'fallback-secret')
    await expectPermitted({ 'x-cron-secret': 'fallback-secret' })
  })

  it('retains error status and cron logging when an authorized sweep fails', async () => {
    seed()
    await fixture.database.run(sql`DROP TABLE call_transcripts`)
    const response = await POST(post())
    expect(response.status).toBe(500)
    expect(fixture.rows(schema.cronRuns)).toEqual([
      expect.objectContaining({ cron: 'suggest-from-transcripts', status: 'error', error: expect.any(String) }),
    ])
    expect(model.suggest).not.toHaveBeenCalled()
  })
})
