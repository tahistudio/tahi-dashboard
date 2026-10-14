import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { eq, is, sql } from 'drizzle-orm'
import { SQLiteTable, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { resolvePermissions } from '@/lib/permissions'
import { loadTaskSuggestionsOverview } from '@/lib/task-suggestions-overview'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'tahi-org',
}))
const sweep = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/lib/task-suggester', async original => ({
  ...await original<typeof import('@/lib/task-suggester')>(),
  runSuggestionSweep: sweep.run,
}))

import { POST as rebuild } from '../rebuild/route'
import { GET as overview } from '@/app/api/admin/overview/route'

let fixture: ReturnType<typeof permissionSqlite>
const at = () => new Date().toISOString()
const orgA = 'org-a'
const orgB = 'org-b'
const request = (body: unknown) => new NextRequest('http://localhost/api/admin/task-suggestions/rebuild', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const getOverview = () => overview(new NextRequest('http://localhost/api/admin/overview'))
const business = () => fixture.queries.filter(query => /\b(?:task_suggestions|call_transcripts|scheduled_calls|discovery_calls)\b/.test(query))
const writes = () => fixture.queries.filter(query => /^(?:insert|update|delete)\b/i.test(query))
const before = () => ({ suggestions: fixture.rows(schema.taskSuggestions), transcripts: fixture.rows(schema.callTranscripts) })
function asUser(userId: string, orgId = 'tahi-org') {
  vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId, sessionId: 'verified-fixture' })
}
function member(user: string, features: string[], scope: string[] | null = [orgA], role = 'designer') {
  fixture.insert(schema.teamMembers, { id: `tm-${user}`, clerk_user_id: user, role: 'member' })
  fixture.insert(schema.roles, { id: `role-${user}`, name: role })
  fixture.insert(schema.teamMemberRoles, { id: `grant-${user}`, team_member_id: `tm-${user}`, role_id: `role-${user}`, ended_at: null })
  for (const feature of features) {
    fixture.insert(schema.permissions, { id: `perm-${user}-${feature}`, resource: feature, action: 'view' })
    fixture.insert(schema.rolePermissions, { id: `rp-${user}-${feature}`, role_id: `role-${user}`, permission_id: `perm-${user}-${feature}` })
  }
  fixture.insert(schema.teamMemberAccess, { id: `scope-${user}`, team_member_id: `tm-${user}`, scope_type: scope === null ? 'all_clients' : 'specific_clients' })
  for (const orgId of scope ?? []) fixture.insert(schema.teamMemberAccessOrgs, { access_id: `scope-${user}`, org_id: orgId })
}
function suggestion(id: string, transcriptId: string, orgId: string | null, status = 'pending') {
  fixture.insert(schema.taskSuggestions, {
    id, transcript_id: transcriptId, org_id: orgId, call_id: `call-${transcriptId}`, kind: orgId ? 'create_request' : 'create_task',
    proposal: JSON.stringify({ title: `Private ${id}` }), quote: `Private quote ${id}`,
    status, dedupe_key: id, created_at: at(), updated_at: at(),
  })
}
function transcript(id: string, orgId: string | null, discovery = false) {
  fixture.insert(discovery ? schema.discoveryCalls : schema.scheduledCalls, {
    id: `call-${id}`, org_id: orgId, title: id, scheduled_at: at(),
  })
  fixture.insert(schema.callTranscripts, {
    id, call_id: `call-${id}`, call_kind: discovery ? 'discovery' : 'scheduled', source: 'manual',
    external_id: id, hash: id, text: `Private transcript ${id}`, received_at: at(), suggested_at: at(),
  })
  suggestion(`s-${id}`, id, orgId)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'tahi-org')
  const tables: AnySQLiteTable[] = []
  for (const value of Object.values(schema)) if (is(value, SQLiteTable)) tables.push(value)
  fixture = permissionSqlite(tables, [
    'ALTER TABLE organisations ADD COLUMN custom_mrr real',
    'ALTER TABLE organisations ADD COLUMN custom_mrr_currency text',
  ])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  fixture.insert(schema.exchangeRates, { currency: 'NZD', rate_to_usd: 0.6, updated_at: at() })
  for (const id of [orgA, orgB]) fixture.insert(schema.organisations, { id, name: id, status: 'active' })
  member('founder', [], null, 'super_admin')
  member('scoped', ['tasks', 'requests'])
  member('empty', ['tasks', 'requests'], [])
  member('requests-only', ['requests'])
  member('tasks-only', ['tasks'])
  member('revoked', ['tasks', 'requests'])
  fixture.insert(schema.teamMembers, { id: 'tm-roleless', clerk_user_id: 'roleless', role: 'admin' })
  transcript('allowed', orgA)
  transcript('foreign', orgB)
  transcript('preclient', null, true)
  suggestion('foreign-on-allowed', 'allowed', orgB)
  suggestion('expired-foreign-on-allowed', 'allowed', orgB, 'expired')
  asUser('scoped')
  sweep.run.mockImplementation(async (_database, options: { transcriptIds: string[]; beforeRead: (id: string) => Promise<void> }) => {
    for (const id of options.transcriptIds) await options.beforeRead(id)
    return { looked: options.transcriptIds.length, deferredIds: [], inserted: 0 }
  })
})
afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

describe('rebuild permissions with real role resolution and SQLite', () => {
  it.each([orgA, orgB])('checks the explicitly selected recording client %s before queueing', async orgId => {
    fixture.insert(schema.callTranscripts, {
      id: 'recorded-transcript', call_id: null, call_kind: null, source: 'manual',
      external_id: 'recording:recorded-call', hash: 'h', text: 'Private recorded transcript',
      received_at: at(), suggested_at: at(),
    })
    fixture.insert(schema.meetingRecordings, {
      id: 'recorded-call', org_id: orgId, transcript_id: 'recorded-transcript', state: 'ready',
    })
    const initial = before()
    const response = await rebuild(request({ transcriptIds: ['recorded-transcript'], readNow: false }))
    expect(response.status).toBe(orgId === orgA ? 200 : 403)
    if (orgId === orgA) {
      await expect(response.json()).resolves.toMatchObject({ transcripts: 1, deferred: 1 })
      const row = fixture.rows(schema.callTranscripts).find(item => item.id === 'recorded-transcript')
      expect(row?.suggested_at).toBeNull()
    } else {
      expect(before()).toEqual(initial)
      expect(writes()).toEqual([])
    }
  })

  it.each(['roleless', 'requests-only', 'tasks-only', 'revoked'])('denies %s before body parsing or business SQL', async user => {
    if (user === 'revoked') await fixture.database.update(schema.teamMemberRoles).set({ endedAt: at() }).where(eq(schema.teamMemberRoles.id, 'grant-revoked'))
    fixture.queries.length = 0
    asUser(user)
    const req = request({ all: true, replace: true, readNow: false })
    const parse = vi.spyOn(req, 'json')
    expect((await rebuild(req)).status).toBe(403)
    expect(parse).not.toHaveBeenCalled()
    expect(business()).toEqual([])
    expect(writes()).toEqual([])
    expect(sweep.run).not.toHaveBeenCalled()
  })
  it.each(['tasks', 'requests'])('honours an explicit %s denial', async feature => {
    fixture.insert(schema.featureVisibility, { id: 'deny', subject_type: 'team_member', subject_id: 'tm-scoped', feature_key: feature, effect: 'deny' })
    expect((await rebuild(request({ all: true, readNow: false }))).status).toBe(403)
    expect(business()).toEqual([])
    expect(writes()).toEqual([])
  })
  it('refuses a client before loading the permission database', async () => {
    asUser('scoped', orgA)
    expect((await rebuild(request({ all: true }))).status).toBe(403)
    expect(db).not.toHaveBeenCalled()
  })
  it('refuses an empty scope before reading even pre-client transcripts', async () => {
    asUser('empty')
    expect((await rebuild(request({ all: true, replace: true, readNow: false }))).status).toBe(403)
    expect(business()).toEqual([])
    expect(writes()).toEqual([])
  })
  it.each(['roles', 'team_member_access', 'scheduled_calls'])('fails closed when a required %s lookup fails', async table => {
    await fixture.database.run(sql.raw(`DROP TABLE ${table}`))
    fixture.queries.length = 0
    expect((await rebuild(request({ transcriptIds: ['allowed'], replace: true, readNow: false }))).status).toBe(403)
    expect(writes()).toEqual([])
    expect(sweep.run).not.toHaveBeenCalled()
  })
  it('filters body.all before expiry and preserves foreign rows even on a permitted transcript', async () => {
    const response = await rebuild(request({ all: true, replace: true, readNow: false }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ transcripts: 2, expired: 2, deferred: 2 })
    const statuses = Object.fromEntries(fixture.rows(schema.taskSuggestions).map(row => [row.id, row.status]))
    expect(statuses).toEqual({ 's-allowed': 'expired', 's-foreign': 'pending', 's-preclient': 'expired', 'foreign-on-allowed': 'pending', 'expired-foreign-on-allowed': 'expired' })
    const keys = Object.fromEntries(fixture.rows(schema.taskSuggestions).map(row => [row.id, row.dedupe_key]))
    expect(keys['expired-foreign-on-allowed']).toBe('expired-foreign-on-allowed')
    const marks = Object.fromEntries(fixture.rows(schema.callTranscripts).map(row => [row.id, row.suggested_at]))
    expect(marks.allowed).toBeNull()
    expect(marks.preclient).toBeNull()
    expect(marks.foreign).not.toBeNull()
    expect(sweep.run).not.toHaveBeenCalled()
    expect(fixture.errors).toEqual([])
  })
  it('allows explicitly named permitted and null-org transcripts', async () => {
    const response = await rebuild(request({ transcriptIds: ['allowed', 'preclient'], readNow: false }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ transcripts: 2, kept: 2, expired: 0, deferred: 2 })
    expect(fixture.rows(schema.taskSuggestions).every(row => row.status !== 'expired' || row.id === 'expired-foreign-on-allowed')).toBe(true)
  })
  it('rejects a mixed named batch before any permitted row can be changed', async () => {
    const initial = before()
    expect((await rebuild(request({ transcriptIds: ['allowed', 'foreign'], replace: true, readNow: false }))).status).toBe(403)
    expect(before()).toEqual(initial)
    expect(writes()).toEqual([])
  })
  it.each(['deal', 'request', 'task', 'attendee', 'request-and-attendee'])('checks the effective client on a null-org %s call', async link => {
    fixture.insert(schema.deals, { id: 'deal-b', org_id: orgB })
    fixture.insert(schema.requests, { id: 'request-a', org_id: orgA })
    fixture.insert(schema.requests, { id: 'request-b', org_id: orgB })
    fixture.insert(schema.tasks, { id: 'task-b', org_id: orgB })
    fixture.insert(schema.contacts, { id: 'contact-b', org_id: orgB, email: 'person@foreign.example' })
    const links = link === 'deal' ? { dealId: 'deal-b' }
      : link === 'request' ? { requestId: 'request-b' }
      : link === 'task' ? { taskId: 'task-b' }
      : { ...(link === 'request-and-attendee' ? { requestId: 'request-a' } : {}), attendees: JSON.stringify([{ email: 'PERSON@foreign.example' }]) }
    await fixture.database.update(schema.discoveryCalls).set(links).where(eq(schema.discoveryCalls.id, 'call-preclient'))
    fixture.queries.length = 0
    const initial = before()
    expect((await rebuild(request({ transcriptIds: ['preclient'], replace: true, readNow: false }))).status).toBe(403)
    expect(before()).toEqual(initial)
    expect(writes()).toEqual([])
  })
  it('does not turn a missing call into an allowed pre-client call', async () => {
    await fixture.database.delete(schema.discoveryCalls).where(eq(schema.discoveryCalls.id, 'call-preclient'))
    fixture.queries.length = 0
    expect((await rebuild(request({ transcriptIds: ['preclient'], readNow: false }))).status).toBe(403)
    expect(writes()).toEqual([])
  })
  it('permits a null-org call whose attendee resolves to the granted client', async () => {
    fixture.insert(schema.contacts, { id: 'contact-a', org_id: orgA, email: 'person@allowed.example' })
    await fixture.database.update(schema.discoveryCalls).set({ attendees: JSON.stringify([{ email: 'PERSON@allowed.example' }]) })
      .where(eq(schema.discoveryCalls.id, 'call-preclient'))
    fixture.queries.length = 0
    expect((await rebuild(request({ transcriptIds: ['preclient'], replace: true, readNow: false }))).status).toBe(200)
    expect(fixture.rows(schema.taskSuggestions).find(row => row.id === 's-preclient')?.status).toBe('expired')
    expect(fixture.rows(schema.taskSuggestions).find(row => row.id === 's-foreign')?.status).toBe('pending')
    expect(fixture.errors).toEqual([])
  })
  it('uses the current scope on a later queue request after access is removed', async () => {
    expect((await rebuild(request({ transcriptIds: ['allowed'], readNow: false }))).status).toBe(200)
    await fixture.database.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, 'scope-scoped'))
    fixture.queries.length = 0
    const initial = before()
    expect((await rebuild(request({ transcriptIds: ['allowed'], replace: true, readNow: false }))).status).toBe(403)
    expect(before()).toEqual(initial)
    expect(business()).toEqual([])
    expect(writes()).toEqual([])
  })
  it('denies scoped inline work before the sweep can run global maintenance', async () => {
    expect((await rebuild(request({ transcriptIds: ['allowed'] }))).status).toBe(403)
    expect(business()).toEqual([])
    expect(writes()).toEqual([])
    expect(sweep.run).not.toHaveBeenCalled()
  })
  it.each(['founder', 'api-service'])('preserves permitted inline work for %s', async user => {
    asUser(user)
    expect((await rebuild(request({ transcriptIds: ['allowed'], replace: true }))).status).toBe(200)
    expect(sweep.run).toHaveBeenCalledWith(fixture.database, expect.objectContaining({ transcriptIds: ['allowed'], startedAt: expect.any(Number), secondPass: true, beforeRead: expect.any(Function) }))
    expect(fixture.rows(schema.taskSuggestions).find(row => row.id === 's-allowed')?.status).toBe('expired')
    expect(fixture.rows(schema.taskSuggestions).find(row => row.id === 's-foreign')?.status).toBe('pending')
    expect(fixture.errors).toEqual([])
  })
})

describe('overview suggestion counts over actual SQLite and current permissions', () => {
  it.each(['roleless', 'requests-only', 'tasks-only', 'revoked'])('returns zero for %s without reading suggestion rows', async user => {
    if (user === 'revoked') await fixture.database.update(schema.teamMemberRoles).set({ endedAt: at() }).where(eq(schema.teamMemberRoles.id, 'grant-revoked'))
    fixture.queries.length = 0
    asUser(user)
    const response = await getOverview()
    if (user === 'roleless' || user === 'revoked') {
      // The overview now refuses a seat with no active role. The count helper
      // must still fail closed when called directly with the same identity.
      expect(response.status).toBe(403)
      const auth = { userId: user, orgId: 'tahi-org' }
      expect(await loadTaskSuggestionsOverview(fixture.database, auth, await resolvePermissions(fixture.database, auth)))
        .toEqual({ pending: 0, calls: 0 })
    } else {
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ kpis: { taskSuggestions: { pending: 0, calls: 0 } } })
    }
    expect(business()).toEqual([])
  })
  it.each(['tasks', 'requests'])('zeros counts when %s is explicitly denied', async feature => {
    fixture.insert(schema.featureVisibility, { id: 'deny', subject_type: 'team_member', subject_id: 'tm-scoped', feature_key: feature, effect: 'deny' })
    await expect((await getOverview()).json()).resolves.toMatchObject({ kpis: { taskSuggestions: { pending: 0, calls: 0 } } })
    expect(business()).toEqual([])
  })
  it('counts only pending permitted and pre-client rows in an aggregate SQL query', async () => {
    await expect((await getOverview()).json()).resolves.toMatchObject({ kpis: { taskSuggestions: { pending: 2, calls: 2 } } })
    const queries = business()
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('count(*)')
    expect(queries[0]).toContain('json_each')
    expect(queries[0]).not.toMatch(/proposal|quote|reject_reason/)
    expect(fixture.errors).toEqual([])
  })
  it('returns zero with no suggestion SQL after current scope is removed', async () => {
    await getOverview()
    await fixture.database.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, 'scope-scoped'))
    fixture.queries.length = 0
    await expect((await getOverview()).json()).resolves.toMatchObject({ kpis: { taskSuggestions: { pending: 0, calls: 0 } } })
    expect(business()).toEqual([])
  })
  it('fails closed after an unavailable current scope lookup', async () => {
    const auth = { userId: 'scoped', orgId: 'tahi-org' }
    const access = await resolvePermissions(fixture.database, auth)
    await fixture.database.run(sql`DROP TABLE team_member_access`)
    fixture.queries.length = 0
    expect(await loadTaskSuggestionsOverview(fixture.database, auth, access)).toEqual({ pending: 0, calls: 0 })
    expect(business()).toEqual([])
  })
  it.each(['founder', 'api-service'])('preserves unrestricted counts for %s', async user => {
    asUser(user)
    await expect((await getOverview()).json()).resolves.toMatchObject({ kpis: { taskSuggestions: { pending: 4, calls: 3 } } })
    expect(fixture.errors).toEqual([])
  })
  it('fails closed when the suggestion table is unavailable', async () => {
    await fixture.database.run(sql`DROP TABLE task_suggestions`)
    const auth = { userId: 'scoped', orgId: 'tahi-org' }
    expect(await loadTaskSuggestionsOverview(fixture.database, auth, await resolvePermissions(fixture.database, auth))).toEqual({ pending: 0, calls: 0 })
  })
  it('keeps a large granted scope inside a single JSON binding', async () => {
    for (let n = 0; n < 180; n++) fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'scope-scoped', org_id: `other-${n}` })
    await expect((await getOverview()).json()).resolves.toMatchObject({ kpis: { taskSuggestions: { pending: 2, calls: 2 } } })
    expect(fixture.errors).toEqual([])
  })
})
