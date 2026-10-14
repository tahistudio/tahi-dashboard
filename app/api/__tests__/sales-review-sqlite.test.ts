import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(), isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { can, resolvePermissions } from '@/lib/permissions'
import { computeBrief } from '@/lib/overview-brief'
import { POST as convert } from '@/app/api/admin/deals/[id]/convert-to-client/route'
import { GET as lead } from '@/app/api/admin/leads/[id]/route'
import * as recordings from '@/app/api/admin/recordings/route'
import { GET as recording } from '@/app/api/admin/recordings/[id]/route'
import * as transcripts from '@/app/api/admin/call-transcripts/[id]/route'
import { PATCH as proposal } from '@/app/api/admin/proposals/[id]/route'
import { requireArtifactAccess } from '@/app/api/admin/_sales-access/artifact-scope'
import { PATCH as schedule } from '@/app/api/admin/schedules/[id]/route'
import { PATCH as contract } from '@/app/api/admin/contracts/[id]/route'
import { PATCH as deal } from '@/app/api/admin/deals/[id]/route'

const TABLES = [
  schema.organisations, schema.contacts, schema.deals, schema.dealContacts, schema.leads,
  schema.discoveryCalls, schema.scheduledCalls, schema.requests, schema.tasks,
  schema.meetingRecordings, schema.meetingRecordingChunks, schema.recorderRecordings,
  schema.callTranscripts, schema.teamMembers, schema.teamMemberRoles, schema.roles,
  schema.permissions, schema.rolePermissions, schema.featureVisibility,
  schema.teamMemberAccess, schema.teamMemberAccessOrgs, schema.pipelineStages,
  schema.kanbanColumns, schema.subscriptions, schema.tracks, schema.settings,
  schema.activities, schema.aiReplyDrafts, schema.proposals, schema.exchangeRates,
  schema.invoices, schema.contractDocuments, schema.messages,
  schema.projectSchedules,
]
let fixture: ReturnType<typeof permissionSqlite>
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
function req(method = 'GET', body?: object) {
  return new NextRequest('http://localhost/api/admin/test', {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}
function auth(seat: string) {
  return { userId: seat === 'api-service' ? seat : `user-${seat}`, orgId: 'org_tahi', sessionId: 'sess_test' }
}
function seat(name: string) { vi.mocked(getRequestAuth).mockResolvedValue(auth(name)) }
function state() { return TABLES.map(table => fixture.rows(table)) }
function seedRecording(id: string, callId: string | null, createdAt = '2026-10-14T00:00:00Z') {
  fixture.insert(schema.meetingRecordings, {
    id, org_id: 'org-a', title: id, call_kind: callId ? 'discovery' : null, call_id: callId,
    tracks: '["mic"]', state: 'ready', created_by_id: 'user-project_manager', created_at: createdAt,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  fixture = permissionSqlite(TABLES, ['ALTER TABLE activities ADD COLUMN metadata text'])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  // Migration 0041's viewer receives every view permission. The PM has the
  // same view grants here; neither role is an admin despite those grants.
  for (const name of ['viewer', 'project_manager', 'admin', 'super_admin']) {
    fixture.insert(schema.roles, { id: `role-${name}`, name })
    fixture.insert(schema.teamMembers, { id: name, clerk_user_id: `user-${name}`, name, role: 'member' })
    fixture.insert(schema.teamMemberRoles, { id: name, team_member_id: name, role_id: `role-${name}`, ended_at: null })
    fixture.insert(schema.teamMemberAccess, { id: name, team_member_id: name, scope_type: 'specific_clients', role: name })
    fixture.insert(schema.teamMemberAccessOrgs, { access_id: name, org_id: 'org-a' })
  }
  for (const resource of ['deals', 'leads', 'calls', 'requests', 'tasks', 'proposals', 'schedules', 'organisations', 'invoices', 'contracts']) {
    fixture.insert(schema.permissions, { id: resource, resource, action: 'view' })
    for (const name of ['viewer', 'project_manager']) {
      fixture.insert(schema.rolePermissions, { id: `${name}-${resource}`, role_id: `role-${name}`, permission_id: resource })
    }
  }
  for (const suffix of ['a', 'b']) {
    fixture.insert(schema.organisations, { id: `org-${suffix}`, name: suffix, status: 'active' })
    fixture.insert(schema.requests, { id: `request-${suffix}`, org_id: `org-${suffix}`, title: suffix })
    fixture.insert(schema.tasks, { id: `task-${suffix}`, org_id: `org-${suffix}`, title: suffix })
    fixture.insert(schema.deals, { id: `deal-${suffix}`, org_id: `org-${suffix}`, title: suffix })
    fixture.insert(schema.contacts, { id: `contact-${suffix}`, org_id: `org-${suffix}`, name: suffix })
    fixture.insert(schema.discoveryCalls, { id: `call-${suffix}`, org_id: `org-${suffix}`, title: suffix, status: 'scheduled', scheduled_at: new Date().toISOString() })
  }
  fixture.insert(schema.leads, { id: 'lead', name: 'Lead' })
  fixture.insert(schema.exchangeRates, { currency: 'NZD', rate_to_usd: 0.6 })
  seat('project_manager')
})
afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

describe('sales review, real scoped role controls', () => {
  it.each(['viewer', 'project_manager'])('denies %s creating a new client or relinking through a foreign contact', async name => {
    seat(name)
    expect(can(await resolvePermissions(fixture.database, auth(name)), 'deals')).toBe(true)
    fixture.insert(schema.deals, { id: 'unlinked', org_id: null, title: 'New client' })
    const before = state()
    expect((await convert(req('POST', {}), ctx('unlinked'))).status).toBe(403)
    expect(state()).toEqual(before)
    fixture.insert(schema.dealContacts, { id: 'link', deal_id: 'unlinked', contact_id: 'contact-b' })
    const linkedBefore = state()
    expect((await convert(req('POST', {}), ctx('unlinked'))).status).toBe(403)
    expect(state()).toEqual(linkedBefore)
    expect(fixture.errors).toEqual([])
  })

  it.each(['admin', 'super_admin', 'api-service'])('keeps %s conversion, relinking and artifact mutation working', async name => {
    seat(name)
    fixture.insert(schema.deals, { id: 'new-client', org_id: null, title: 'New client' })
    const response = await convert(req('POST', {}), ctx('new-client'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ created: true })
    fixture.insert(schema.deals, { id: 'contact-client', org_id: null, title: 'Contact client' })
    fixture.insert(schema.dealContacts, { id: 'link', deal_id: 'contact-client', contact_id: 'contact-b' })
    expect((await convert(req('POST', {}), ctx('contact-client'))).status).toBe(200)
    fixture.insert(schema.proposals, { id: 'proposal', org_id: 'org-a', deal_id: 'deal-b', title: 'Legacy mixed links' })
    fixture.insert(schema.projectSchedules, { id: 'schedule', org_id: 'org-a', deal_id: 'deal-b', title: 'Legacy mixed links' })
    fixture.insert(schema.contractDocuments, { id: 'contract', org_id: 'org-a', deal_id: 'deal-b', name: 'Legacy mixed links' })
    expect((await proposal(req('PATCH', { title: 'Updated' }), ctx('proposal'))).status).toBe(200)
    expect((await schedule(req('PATCH', { title: 'Updated' }), ctx('schedule'))).status).toBe(200)
    expect((await contract(req('PATCH', { name: 'Updated' }), ctx('contract'))).status).toBe(200)
    expect(fixture.rows(schema.proposals)[0].title).toBe('Updated')
    expect(fixture.errors).toEqual([])
  })

  it.each(['viewer', 'project_manager'])('checks %s artifact deal access and matching parents before mutation', async name => {
    seat(name)
    const access = await resolvePermissions(fixture.database, auth(name))
    for (const feature of ['proposals', 'schedules', 'contracts']) expect(can(access, feature)).toBe(true)
    fixture.insert(schema.proposals, { id: 'proposal', org_id: 'org-a', deal_id: 'deal-b', title: 'Hidden' })
    fixture.insert(schema.projectSchedules, { id: 'schedule', org_id: 'org-a', deal_id: 'deal-b', title: 'Hidden' })
    fixture.insert(schema.contractDocuments, { id: 'contract', org_id: 'org-a', deal_id: 'deal-b', name: 'Hidden' })
    const before = state()
    expect((await proposal(req('PATCH', { title: 'Denied' }), ctx('proposal'))).status).toBe(403)
    expect((await schedule(req('PATCH', { title: 'Denied' }), ctx('schedule'))).status).toBe(403)
    expect((await contract(req('PATCH', { name: 'Denied' }), ctx('contract'))).status).toBe(403)
    expect(state()).toEqual(before)
    fixture.insert(schema.deals, { id: 'pre-client', org_id: null, title: 'Pre-client' })
    expect((await requireArtifactAccess(fixture.database, auth(name), { orgId: 'org-a', dealId: 'pre-client' }))?.status).toBe(403)
    expect(await requireArtifactAccess(fixture.database, auth(name), { orgId: 'org-a', dealId: 'deal-a' })).toBeNull()
    expect(fixture.errors).toEqual([])
  })

  it('binds a quoted deal id when calculating stage dwell time', async () => {
    seat('admin')
    const id = "deal'quoted"
    fixture.insert(schema.pipelineStages, { id: 'old-stage', name: 'Old', is_closed_won: 0, is_closed_lost: 0 })
    fixture.insert(schema.pipelineStages, { id: 'next-stage', name: 'Next', is_closed_won: 0, is_closed_lost: 0 })
    fixture.insert(schema.deals, { id, title: 'Quoted id', org_id: 'org-a', stage_id: 'old-stage' })
    fixture.insert(schema.activities, { id: 'creation', deal_id: id, type: 'deal_created', created_at: '2026-10-01T00:00:00Z' })
    expect((await deal(req('PATCH', { stageId: 'next-stage' }), ctx(id))).status).toBe(200)
    const activity = fixture.rows(schema.activities).find(row => row.type === 'stage_change')
    expect(activity?.description).toMatch(/^Spent \d+ days in Old$/)
    expect(fixture.errors).toEqual([])
  })
})

describe('sales review, every discovery recording parent', () => {
  it.each(['requestId', 'taskId', 'dealId'] as const)('fences a recording with a foreign %s in read, create and recorder transcript handlers', async parent => {
    await fixture.database.update(schema.discoveryCalls).set({ [parent]: `${parent.replace('Id', '')}-b` }).where(eq(schema.discoveryCalls.id, 'call-a'))
    seedRecording('recording', 'call-a')
    fixture.insert(schema.callTranscripts, { id: 'transcript', source: 'manual', external_id: 'recording:recording', call_kind: 'discovery', call_id: 'call-a', text: 'Private notes' })
    const before = state()
    expect((await recording(req(), ctx('recording'))).status).toBe(403)
    expect((await recordings.POST(req('POST', { title: 'Denied', tracks: ['mic'], callKind: 'discovery', callId: 'call-a' }))).status).toBe(403)
    expect((await transcripts.GET(req(), ctx('transcript'))).status).toBe(403)
    expect((await transcripts.PATCH(req('PATCH', { callKind: 'discovery', callId: 'call-b' }), ctx('transcript'))).status).toBe(403)
    expect(state()).toEqual(before)
    expect(fixture.errors).toEqual([])
  })

  it('applies the discovery EXISTS fence before the recording list cap', async () => {
    seedRecording('visible', 'call-a', '2026-01-01T00:00:00Z')
    for (let index = 0; index < 120; index++) seedRecording(`foreign-${index}`, 'call-b', '2099-01-01T00:00:00Z')
    const response = await recordings.GET(req())
    expect(response.status).toBe(200)
    expect((await response.json() as { items: Array<{ id: string }> }).items.map(item => item.id)).toEqual(['visible'])
    expect(fixture.errors).toEqual([])
  })

  it.each(['admin', 'super_admin', 'api-service'])('keeps %s recording and recorder transcript reads working', async name => {
    seat(name)
    seedRecording('recording', 'call-b')
    fixture.insert(schema.callTranscripts, { id: 'transcript', source: 'manual', external_id: 'recording:recording', call_kind: 'discovery', call_id: 'call-b', text: 'Allowed notes' })
    expect((await recording(req(), ctx('recording'))).status).toBe(200)
    expect((await transcripts.GET(req(), ctx('transcript'))).status).toBe(200)
    expect((await recordings.GET(req())).status).toBe(200)
    expect(fixture.errors).toEqual([])
  })
})

describe('sales review, lead detail and overview brief', () => {
  it('uses the parent-call list scope on lead detail', async () => {
    for (const suffix of ['a', 'b']) await fixture.database.update(schema.discoveryCalls).set({ leadId: 'lead' }).where(eq(schema.discoveryCalls.id, `call-${suffix}`))
    const response = await lead(req(), ctx('lead'))
    expect(response.status).toBe(200)
    expect((await response.json() as { calls: Array<{ id: string }> }).calls.map(call => call.id)).toEqual(['call-a'])
    expect(fixture.errors).toEqual([])
  })

  it('fences the brief call parents and overnight replies, and honours deny-all', async () => {
    await fixture.database.update(schema.discoveryCalls).set({ requestId: 'request-b' }).where(eq(schema.discoveryCalls.id, 'call-a'))
    const now = new Date().toISOString()
    for (const [id, orgId, requestId] of [['visible', 'org-a', 'request-a'], ['mixed', 'org-a', 'request-b'], ['foreign', 'org-b', 'request-b']] as const) {
      fixture.insert(schema.messages, { id, org_id: orgId, request_id: requestId, author_type: 'contact', created_at: now })
    }
    const access = await resolvePermissions(fixture.database, auth('project_manager'))
    const result = await computeBrief(fixture.database, auth('project_manager'), { access, allowedOrgs: ['org-a'] })
    expect(result.urgent).toEqual([])
    expect(result.slept).toEqual([{ tone: '', verb: null, to: 'messages', text: '1 client reply came in overnight' }])
    expect(await computeBrief(fixture.database, auth('project_manager'), { access, allowedOrgs: [] })).toEqual({ urgent: [], week: [], slept: [] })
    expect(fixture.errors).toEqual([])
  })
})
