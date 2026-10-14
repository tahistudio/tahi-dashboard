import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: vi.fn(), auth: vi.fn(), currentUser: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import * as contacts from '@/app/api/admin/clients/[id]/contacts/route'
import * as calls from '@/app/api/admin/clients/[id]/calls/route'
import * as tracks from '@/app/api/admin/clients/[id]/tracks/route'
import * as pm from '@/app/api/admin/clients/[id]/pm/route'
import * as derive from '@/app/api/admin/clients/[id]/auto-derive/route'
import * as brands from '@/app/api/admin/brands/[id]/route'
import { POST as createBrand } from '@/app/api/admin/brands/route'
import { GET as exportRequests } from '@/app/api/admin/export/requests/route'
import { GET as exportTime } from '@/app/api/admin/export/time/route'
import * as activities from '@/app/api/admin/activities/route'
import * as activity from '@/app/api/admin/activities/[id]/route'
import { PUT as reorder } from '@/app/api/admin/tracks/[trackId]/reorder/route'
import { GET as delivery } from '@/app/api/admin/engagements/delivery-status/route'
import { GET as offTrack } from '@/app/api/admin/engagements/off-track/route'
import { GET as audit } from '@/app/api/admin/audit/route'
import * as forms from '@/app/api/admin/forms/route'
import { GET as resolveForm } from '@/app/api/admin/forms/resolve/route'
import * as form from '@/app/api/admin/forms/[id]/route'
import * as columns from '@/app/api/admin/kanban-columns/route'
import * as column from '@/app/api/admin/kanban-columns/[id]/route'
import * as templates from '@/app/api/admin/task-templates/route'
import * as template from '@/app/api/admin/task-templates/[id]/route'
import { POST as fromTemplate } from '@/app/api/admin/tasks/from-template/route'
import { GET as subscriptions } from '@/app/api/admin/subscriptions/route'
import * as subscription from '@/app/api/admin/subscriptions/[id]/route'
import { POST as changeCycle } from '@/app/api/admin/subscriptions/[id]/change-cycle/route'
import { POST as stampInvoiced } from '@/app/api/admin/time/stamp-invoiced/route'
import * as timers from '@/app/api/admin/timers/route'
import * as timer from '@/app/api/admin/timers/[id]/route'
import { POST as pingTimer } from '@/app/api/admin/timers/ping/route'
import { POST as normalizeTimes } from '@/app/api/admin/calls/normalize-times/route'
import { GET as views } from '@/app/api/admin/views/route'
import { GET as sectionViews } from '@/app/api/admin/views/sections/route'
import { GET as transcripts } from '@/app/api/admin/call-transcripts/route'
import * as transcript from '@/app/api/admin/call-transcripts/[id]/route'
import { GET as callIndex } from '@/app/api/admin/calls/index/route'
import { GET as transcriptCalls } from '@/app/api/admin/call-transcripts/calls/route'
import * as conversations from '@/app/api/admin/conversations/route'
import * as conversationMessages from '@/app/api/admin/conversations/[id]/messages/route'
import * as taskBlockers from '@/app/api/admin/tasks/[id]/blockers/route'
import * as taskDependencies from '@/app/api/admin/tasks/[id]/dependencies/route'
import { GET as blockerSearch } from '@/app/api/admin/blockers/search/route'
import * as requestSteps from '@/app/api/admin/requests/[id]/steps/route'
import * as requestStep from '@/app/api/admin/requests/[id]/steps/[stepId]/route'
import * as requestParticipants from '@/app/api/admin/requests/[id]/participants/route'
import { POST as bulkAssign } from '@/app/api/admin/requests/bulk-assign/route'
import { GET as subRequests } from '@/app/api/admin/requests/[id]/sub-requests/route'
import { PATCH as reorderSubRequests } from '@/app/api/admin/requests/[id]/sub-requests/reorder/route'
import { GET as requestDetail } from '@/app/api/admin/requests/[id]/route'
import { GET as timeEntryList } from '@/app/api/admin/time-entries/route'
import { GET as requestTimeEntryList } from '@/app/api/admin/requests/[id]/time-entries/route'
import { INTERNAL_ORG_ID } from '@/lib/internal-org'
import * as requestMessages from '@/app/api/admin/requests/[id]/messages/route'
import { GET as requestFiles } from '@/app/api/admin/requests/[id]/files/route'
import * as requestVoiceNotes from '@/app/api/admin/requests/[id]/voice-notes/route'
import { loadThreadMessages, loadInboxThreads } from '@/lib/messages-store'
import { scopedOrgIds } from '@/lib/access-scope'

const A = 'org-a'
const B = 'org-b'
const TABLES = [
  schema.organisations, schema.contacts, schema.brands, schema.brandContacts,
  schema.discoveryCalls, schema.activities, schema.leads, schema.deals,
  schema.requests, schema.tasks, schema.subscriptions, schema.tracks,
  schema.teamMembers, schema.teamMemberAccess, schema.teamMemberAccessOrgs,
  schema.roles, schema.teamMemberRoles, schema.permissions, schema.rolePermissions,
  schema.featureVisibility, schema.projectSchedules, schema.scheduleRows,
  schema.projects, schema.timeEntries, schema.invoices, schema.pipelineStages,
  schema.auditLog, schema.requestForms, schema.kanbanColumns, schema.taskTemplates, schema.activeTimers,
  schema.shareViewEvents, schema.shareSectionViews, schema.proposals, schema.contractDocuments, schema.callTranscripts,
  schema.conversations, schema.conversationParticipants, schema.messages, schema.meetingRecordings, schema.scheduledCalls, schema.workBlockers, schema.requestSteps, schema.requestParticipants, schema.requestReads,
  schema.files, schema.voiceNotes,
]
let fixture: ReturnType<typeof permissionSqlite>

function req(method: string, body?: object, query = '') {
  return new NextRequest(`http://localhost/api/admin/test${query}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

function denyFeature(feature: string) {
  fixture.insert(schema.featureVisibility, {
    id: `deny-${feature}`, subject_type: 'team_member', subject_id: 'member', feature_key: feature, effect: 'deny',
  })
}

function dataState() {
  return TABLES.filter(table => table !== schema.featureVisibility)
    .map(table => fixture.rows(table))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  fixture = permissionSqlite(TABLES, [
    'ALTER TABLE organisations ADD COLUMN billing_model_is_manual integer',
    'ALTER TABLE organisations ADD COLUMN retainer_dates_is_manual integer',
    'ALTER TABLE organisations ADD COLUMN custom_mrr_is_manual integer',
    'ALTER TABLE organisations ADD COLUMN billing_model text',
    'ALTER TABLE organisations ADD COLUMN retainer_start_date text',
    'ALTER TABLE organisations ADD COLUMN retainer_end_date text',
    'ALTER TABLE organisations ADD COLUMN custom_mrr integer',
  ])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi', sessionId: 'test' })
  fixture.insert(schema.roles, { id: 'role-member', name: 'project_manager' })
  fixture.insert(schema.roles, { id: 'role-super', name: 'super_admin' })
  fixture.insert(schema.teamMembers, { id: 'member', clerk_user_id: 'user_member', name: 'Scoped member', role: 'member' })
  fixture.insert(schema.teamMembers, { id: 'super', clerk_user_id: 'user_super', name: 'Super admin', role: 'admin' })
  fixture.insert(schema.teamMemberRoles, { id: 'member-role', team_member_id: 'member', role_id: 'role-member', ended_at: null })
  fixture.insert(schema.teamMemberRoles, { id: 'super-role', team_member_id: 'super', role_id: 'role-super', ended_at: null })
  for (const resource of ['organisations', 'requests', 'schedules', 'deals', 'leads', 'settings', 'tasks', 'billing', 'time_entries', 'calls', 'proposals', 'contracts', 'invoices']) {
    fixture.insert(schema.permissions, { id: resource, resource, action: 'view' })
    fixture.insert(schema.rolePermissions, { id: resource, role_id: 'role-member', permission_id: resource })
  }
  fixture.insert(schema.teamMemberAccess, { id: 'scope', team_member_id: 'member', role: 'task_handler', scope_type: 'specific_clients' })
  fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'scope', org_id: A })
  for (const [org, suffix] of [[A, 'a'], [B, 'b']] as const) {
    fixture.insert(schema.requestForms, { id: `form-${suffix}`, org_id: org, name: suffix, questions: '[]' })
    fixture.insert(schema.kanbanColumns, { id: `column-${suffix}`, org_id: org, label: suffix, status_value: 'custom', position: 0 })
    fixture.insert(schema.taskTemplates, { id: `template-${suffix}`, org_id: org, name: suffix, type: 'client_task', subtasks: '[]' })
    fixture.insert(schema.proposals, { id: `proposal-${suffix}`, org_id: org, title: suffix })
    fixture.insert(schema.organisations, { id: org, name: org, status: 'active', billing_model: 'manual', custom_mrr: null })
    fixture.insert(schema.contacts, { id: `contact-${suffix}`, org_id: org, name: suffix, email: `${suffix}@example.test` })
    fixture.insert(schema.brands, { id: `brand-${suffix}`, org_id: org, name: suffix })
    fixture.insert(schema.subscriptions, { id: `sub-${suffix}`, org_id: org, status: 'active', plan_type: 'maintain' })
    fixture.insert(schema.tracks, { id: `track-${suffix}`, subscription_id: `sub-${suffix}`, type: 'small' })
    fixture.insert(schema.requests, { id: `request-${suffix}`, org_id: org, status: 'submitted', queue_order: 7, brand_id: `brand-${suffix}` })
    fixture.insert(schema.deals, { id: `deal-${suffix}`, org_id: org, title: suffix })
    fixture.insert(schema.activities, { id: `activity-${suffix}`, org_id: org, title: suffix, type: 'note' })
    fixture.insert(schema.discoveryCalls, { id: `call-${suffix}`, org_id: org, title: suffix, scheduled_at: '2026-10-13T00:00:00Z' })
    fixture.insert(schema.projectSchedules, { id: `schedule-${suffix}`, org_id: org, deal_id: `deal-${suffix}`, title: suffix, status: 'published' })
    fixture.insert(schema.scheduleRows, { id: `row-${suffix}`, schedule_id: `schedule-${suffix}`, label: suffix, row_type: 'deliverable' })
    fixture.insert(schema.tasks, { id: `task-${suffix}`, org_id: org, schedule_row_id: `row-${suffix}`, status: 'blocked' })
  }
  fixture.insert(schema.auditLog, { id: 'audit-1', action: 'permission.changed', entity_type: 'organisation', entity_id: B })
})

afterEach(() => {
  fixture.close()
  vi.unstubAllEnvs()
})

type IdHandler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>
const CASES: Array<{ name: string; method: string; handler: IdHandler; feature: string; id: (suffix: string) => string; body?: object }> = [
  { name: 'contacts GET', method: 'GET', handler: contacts.GET, feature: 'clients', id: suffix => `org-${suffix}` },
  { name: 'contacts POST', method: 'POST', handler: contacts.POST, feature: 'clients', id: suffix => `org-${suffix}`, body: { name: 'New', email: 'new@example.test' } },
  { name: 'calls GET', method: 'GET', handler: calls.GET, feature: 'clients', id: suffix => `org-${suffix}` },
  { name: 'calls POST', method: 'POST', handler: calls.POST, feature: 'clients', id: suffix => `org-${suffix}`, body: { title: 'Check-in', scheduledAt: '2026-10-13T00:00:00Z' } },
  { name: 'tracks GET', method: 'GET', handler: tracks.GET, feature: 'clients', id: suffix => `org-${suffix}` },
  { name: 'tracks POST', method: 'POST', handler: tracks.POST, feature: 'clients', id: suffix => `org-${suffix}`, body: { subscriptionId: 'sub-a', planType: 'maintain' } },
  { name: 'pm GET', method: 'GET', handler: pm.GET, feature: 'clients', id: suffix => `org-${suffix}` },
  { name: 'auto-derive POST', method: 'POST', handler: derive.POST, feature: 'clients', id: suffix => `org-${suffix}`, body: { clearOverrides: { billingModel: true } } },
  { name: 'brands GET', method: 'GET', handler: brands.GET, feature: 'clients', id: suffix => `brand-${suffix}` },
  { name: 'brands PATCH', method: 'PATCH', handler: brands.PATCH, feature: 'clients', id: suffix => `brand-${suffix}`, body: { name: 'Updated' } },
  { name: 'brands DELETE', method: 'DELETE', handler: brands.DELETE, feature: 'clients', id: suffix => `brand-${suffix}` },
  { name: 'activity PATCH', method: 'PATCH', handler: activity.PATCH, feature: 'clients', id: suffix => `activity-${suffix}`, body: { title: 'Updated' } },
  { name: 'activity DELETE', method: 'DELETE', handler: activity.DELETE, feature: 'clients', id: suffix => `activity-${suffix}` },
]

describe.each(CASES)('$name uses the authenticated scoped seat', scenario => {
  it('permits the assigned client through real permission and route SQL', async () => {
    const foreignBefore = fixture.rows(schema.organisations).find(row => row.id === B)
    const response = await scenario.handler(req(scenario.method, scenario.body), { params: Promise.resolve({ id: scenario.id('a') }) })
    expect(response.status).toBe(scenario.method === 'POST' && ['calls POST', 'tracks POST'].includes(scenario.name) ? 201 : 200)
    expect(fixture.errors).toEqual([])
    expect(fixture.rows(schema.organisations).find(row => row.id === B)).toEqual(foreignBefore)
  })

  it('refuses the foreign client before any mutation', async () => {
    // Recorded attribution cannot upgrade the caller's authorization identity.
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_member', orgId: 'org_tahi', sessionId: 'test',
      mcpActor: { teamMemberId: 'super', clerkUserId: 'user_super', profile: 'full' },
    })
    const before = dataState()
    const response = await scenario.handler(req(scenario.method, scenario.body), { params: Promise.resolve({ id: scenario.id('b') }) })
    expect(response.status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('refuses an explicit feature denial even for an assigned client', async () => {
    denyFeature(scenario.feature)
    const before = dataState()
    const response = await scenario.handler(req(scenario.method, scenario.body), { params: Promise.resolve({ id: scenario.id('a') }) })
    expect(response.status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('denies a seat with features but no client access rule', async () => {
    await fixture.database.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, 'scope'))
    const before = dataState()
    const response = await scenario.handler(req(scenario.method, scenario.body), { params: Promise.resolve({ id: scenario.id('a') }) })
    expect(response.status).toBe(403)
    expect(dataState()).toEqual(before)
  })
})

describe('nested targets cannot override the permitted client', () => {
  it('permits a brand for an assigned client', async () => {
    const response = await createBrand(req('POST', { name: 'Allowed brand', orgId: A }))
    expect(response.status).toBe(201)
    expect(fixture.rows(schema.brands).filter(row => row.name === 'Allowed brand')).toMatchObject([{ org_id: A }])
    expect(fixture.errors).toEqual([])
  })

  it('refuses a foreign brand without writing, regardless of recorded actor', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_member', orgId: 'org_tahi', sessionId: 'test',
      mcpActor: { teamMemberId: 'super', clerkUserId: 'user_super', profile: 'full' },
    })
    const before = dataState()
    expect((await createBrand(req('POST', { name: 'Foreign brand', orgId: B }))).status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('requires the clients feature and an existing brand client', async () => {
    const before = fixture.rows(schema.brands)
    expect((await createBrand(req('POST', { name: 'Missing brand', orgId: 'missing' }))).status).toBe(404)
    denyFeature('clients')
    expect((await createBrand(req('POST', { name: 'Denied brand', orgId: A }))).status).toBe(403)
    expect(fixture.rows(schema.brands)).toEqual(before)
  })
  it('does not provision tracks for another client subscription', async () => {
    const before = fixture.rows(schema.tracks)
    const response = await tracks.POST(req('POST', { subscriptionId: 'sub-b', planType: 'scale' }), { params: Promise.resolve({ id: A }) })
    expect(response.status).toBe(404)
    expect(fixture.rows(schema.tracks)).toEqual(before)
  })

  it.each(['orgId', 'contactId', 'dealId'] as const)('refuses an activity move through %s', async field => {
    const before = fixture.rows(schema.activities)
    const value = field === 'orgId' ? B : field === 'contactId' ? 'contact-b' : 'deal-b'
    const response = await activity.PATCH(req('PATCH', { [field]: value }), { params: Promise.resolve({ id: 'activity-a' }) })
    expect(response.status).toBe(403)
    expect(fixture.rows(schema.activities)).toEqual(before)
  })

  it('hides a foreign current request linked to a permitted client track', async () => {
    await fixture.database.update(schema.tracks).set({ currentRequestId: 'request-b' }).where(eq(schema.tracks.id, 'track-a'))
    const response = await tracks.GET(req('GET'), { params: Promise.resolve({ id: A }) })
    expect(response.status).toBe(200)
    const body = await response.json() as { tracks: Array<{ currentRequestId: string | null; currentRequestTitle: string | null }> }
    expect(body.tracks[0]).toMatchObject({ currentRequestId: null, currentRequestTitle: null })
    expect(JSON.stringify(body)).not.toContain('request-b')
  })

  it('filters foreign contacts and requests linked to a permitted brand, including delete writes', async () => {
    fixture.insert(schema.brandContacts, { id: 'allowed-contact', brand_id: 'brand-a', contact_id: 'contact-a' })
    fixture.insert(schema.brandContacts, { id: 'foreign-contact', brand_id: 'brand-a', contact_id: 'contact-b' })
    await fixture.database.update(schema.requests).set({ brandId: 'brand-a' }).where(eq(schema.requests.id, 'request-b'))
    const response = await brands.GET(req('GET'), { params: Promise.resolve({ id: 'brand-a' }) })
    expect(response.status).toBe(200)
    const body = await response.json() as { requestCount: number; contacts: Array<{ id: string }> }
    expect(body.requestCount).toBe(1)
    expect(body.contacts.map(contact => contact.id)).toEqual(['contact-a'])
    expect((await brands.DELETE(req('DELETE'), { params: Promise.resolve({ id: 'brand-a' }) })).status).toBe(200)
    expect(fixture.rows(schema.requests).find(row => row.id === 'request-b')?.brand_id).toBe('brand-a')
    expect(fixture.rows(schema.requests).find(row => row.id === 'request-a')?.brand_id).toBe(null)
  })
})

describe('activity index and create enforce every linked parent', () => {
  it.each(['orgId', 'contactId', 'dealId'] as const)('scopes GET and POST through %s', async field => {
    const permitted = field === 'orgId' ? A : field === 'contactId' ? 'contact-a' : 'deal-a'
    const foreign = field === 'orgId' ? B : field === 'contactId' ? 'contact-b' : 'deal-b'
    expect((await activities.GET(req('GET', undefined, `?${field}=${permitted}`))).status).toBe(200)
    expect((await activities.POST(req('POST', { type: 'note', title: 'Allowed', [field]: permitted }))).status).toBe(201)
    const before = fixture.rows(schema.activities)
    expect((await activities.GET(req('GET', undefined, `?${field}=${foreign}`))).status).toBe(403)
    expect((await activities.POST(req('POST', { type: 'note', title: 'Denied', [field]: foreign }))).status).toBe(403)
    expect(fixture.rows(schema.activities)).toEqual(before)
    denyFeature(field === 'dealId' ? 'deals' : 'clients')
    expect((await activities.GET(req('GET', undefined, `?${field}=${permitted}`))).status).toBe(403)
    expect((await activities.POST(req('POST', { type: 'note', title: 'Denied', [field]: permitted }))).status).toBe(403)
  })

  it('filters all parent links before LIMIT, including contact-only and deal-only rows', async () => {
    fixture.insert(schema.activities, { id: 'contact-only', contact_id: 'contact-a', title: 'Contact', type: 'note' })
    fixture.insert(schema.activities, { id: 'deal-only', deal_id: 'deal-a', title: 'Deal', type: 'note' })
    for (let index = 0; index < 110; index++) fixture.insert(schema.activities, {
      id: `foreign-${index}`, org_id: A, contact_id: 'contact-b', type: 'note', title: 'Foreign contact', created_at: '2099-01-01',
    })
    const response = await activities.GET(req('GET'))
    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ id: string }> }
    expect(body.items.map(item => item.id).sort()).toEqual(['activity-a', 'contact-only', 'deal-only'])
    expect(fixture.errors).toEqual([])
  })
})

describe('track reorder fences the parent and every child', () => {
  it('updates only the permitted client request', async () => {
    const response = await reorder(req('PUT', { requestIds: ['request-a'] }), { params: Promise.resolve({ trackId: 'track-a' }) })
    expect(response.status).toBe(200)
    expect(fixture.rows(schema.requests).find(row => row.id === 'request-a')?.queue_order).toBe(0)
    expect(fixture.rows(schema.requests).find(row => row.id === 'request-b')?.queue_order).toBe(7)
  })
  it('refuses a foreign track and rejects a mixed-client request batch without partial writes', async () => {
    const before = fixture.rows(schema.requests)
    expect((await reorder(req('PUT', { requestIds: ['request-b'] }), { params: Promise.resolve({ trackId: 'track-b' }) })).status).toBe(403)
    expect((await reorder(req('PUT', { requestIds: ['request-a', 'request-b'] }), { params: Promise.resolve({ trackId: 'track-a' }) })).status).toBe(400)
    expect(fixture.rows(schema.requests)).toEqual(before)
  })
  it('requires the requests feature', async () => {
    denyFeature('requests')
    expect((await reorder(req('PUT', { requestIds: ['request-a'] }), { params: Promise.resolve({ trackId: 'track-a' }) })).status).toBe(403)
  })
})

describe('engagements use schedule features and client scope', () => {
  it('includes pre-client deal schedules only for a seat with some client scope', async () => {
    fixture.insert(schema.deals, { id: 'pre-client-deal', org_id: null, title: 'Opportunity' })
    fixture.insert(schema.projectSchedules, { id: 'pre-client-schedule', org_id: null, deal_id: 'pre-client-deal', title: 'Opportunity', status: 'published' })
    fixture.insert(schema.scheduleRows, { id: 'pre-client-row', schedule_id: 'pre-client-schedule', label: 'Deliverable', row_type: 'deliverable' })
    fixture.insert(schema.tasks, { id: 'pre-client-task', org_id: null, schedule_row_id: 'pre-client-row', status: 'blocked' })
    fixture.insert(schema.projectSchedules, { id: 'foreign-pre-client-schedule', org_id: B, deal_id: 'pre-client-deal', title: 'Foreign', status: 'published' })
    fixture.insert(schema.scheduleRows, { id: 'foreign-pre-client-row', schedule_id: 'foreign-pre-client-schedule', label: 'Foreign', row_type: 'deliverable' })
    const response = await delivery(req('GET', undefined, '?dealId=pre-client-deal'))
    expect(response.status).toBe(200)
    expect((await response.json() as { perSchedule: Array<{ scheduleId: string }> }).perSchedule.map(item => item.scheduleId)).toEqual(['pre-client-schedule'])
    await fixture.database.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, 'scope'))
    expect((await delivery(req('GET', undefined, '?dealId=pre-client-deal'))).status).toBe(403)
    expect(fixture.errors).toEqual([])
  })
  it.each(['orgId', 'dealId'])('guards delivery status by %s', async filter => {
    const allowed = filter === 'orgId' ? A : 'deal-a'
    const foreign = filter === 'orgId' ? B : 'deal-b'
    const response = await delivery(req('GET', undefined, `?${filter}=${allowed}`))
    expect(response.status).toBe(200)
    expect((await response.json() as { perSchedule: Array<{ scheduleId: string }> }).perSchedule.map(item => item.scheduleId)).toEqual(['schedule-a'])
    expect((await delivery(req('GET', undefined, `?${filter}=${foreign}`))).status).toBe(403)
    denyFeature('schedules')
    expect((await delivery(req('GET', undefined, `?${filter}=${allowed}`))).status).toBe(403)
    expect(fixture.errors).toEqual([])
  })
  it('lists and aggregates only permitted engagements', async () => {
    const response = await offTrack(req('GET'))
    expect(response.status).toBe(200)
    expect((await response.json() as { engagements: Array<{ orgId: string }> }).engagements.map(item => item.orgId)).toEqual([A])
    expect(fixture.errors).toEqual([])
    denyFeature('schedules')
    expect((await offTrack(req('GET'))).status).toBe(403)
  })

  it('inherits an unassigned schedule org from its deal and ignores foreign schedules on an allowed deal', async () => {
    fixture.insert(schema.projectSchedules, { id: 'inherited-a', org_id: null, deal_id: 'deal-a', title: 'Inherited', status: 'published' })
    fixture.insert(schema.scheduleRows, { id: 'inherited-row', schedule_id: 'inherited-a', label: 'Inherited', row_type: 'deliverable' })
    fixture.insert(schema.tasks, { id: 'inherited-task', org_id: A, schedule_row_id: 'inherited-row', status: 'blocked' })
    fixture.insert(schema.projectSchedules, { id: 'foreign-on-allowed-deal', org_id: B, deal_id: 'deal-a', title: 'Foreign', status: 'published' })
    fixture.insert(schema.scheduleRows, { id: 'foreign-row', schedule_id: 'foreign-on-allowed-deal', label: 'Foreign', row_type: 'deliverable' })
    fixture.insert(schema.tasks, { id: 'foreign-task', org_id: B, schedule_row_id: 'foreign-row', status: 'blocked' })
    const response = await delivery(req('GET', undefined, '?dealId=deal-a'))
    expect((await response.json() as { perSchedule: Array<{ scheduleId: string }> }).perSchedule.map(item => item.scheduleId).sort()).toEqual(['inherited-a', 'schedule-a'])
    const offTrackResponse = await offTrack(req('GET'))
    const body = await offTrackResponse.json() as { engagements: Array<{ orgId: string; rowsTotal: number }> }
    expect(body.engagements.map(item => [item.orgId, item.rowsTotal])).toEqual([[A, 2]])
    expect(fixture.errors).toEqual([])
  })

  it('returns no engagements for a feature-granted seat with an empty org scope', async () => {
    await fixture.database.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, 'scope'))
    const response = await offTrack(req('GET'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ engagements: [] })
    expect((await delivery(req('GET', undefined, '?orgId=org-a'))).status).toBe(403)
  })

  it('excludes foreign work linked to an allowed schedule row from the status rollup', async () => {
    await fixture.database.update(schema.tasks).set({ status: 'done' }).where(eq(schema.tasks.id, 'task-a'))
    await fixture.database.update(schema.tasks).set({ scheduleRowId: 'row-a', status: 'blocked' }).where(eq(schema.tasks.id, 'task-b'))
    await fixture.database.update(schema.requests).set({ scheduleRowId: 'row-a', status: 'on_hold' }).where(eq(schema.requests.id, 'request-b'))
    const response = await delivery(req('GET', undefined, '?orgId=org-a'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ engagement: { status: 'done', rowsDone: 1, rowsTotal: 1 }, offTrackRows: [] })
    const offTrackResponse = await offTrack(req('GET'))
    expect(await offTrackResponse.json()).toEqual({ engagements: [] })
    expect(fixture.errors).toEqual([])
  })
})

describe('CSV exports use the authenticated seat client scope', () => {
  beforeEach(async () => {
    fixture.insert(schema.permissions, { id: 'time-view', resource: 'time_entries', action: 'view' })
    fixture.insert(schema.rolePermissions, { id: 'time-view', role_id: 'role-member', permission_id: 'time-view' })
    for (const suffix of ['a', 'b']) {
      await fixture.database.update(schema.requests).set({ title: `Request ${suffix}` }).where(eq(schema.requests.id, `request-${suffix}`))
      fixture.insert(schema.timeEntries, { id: `time-${suffix}`, org_id: `org-${suffix}`, request_id: `request-${suffix}`, team_member_id: 'member', date: '2026-10-13', hours: 1, notes: `Time ${suffix}` })
    }
  })

  it.each([
    { handler: exportRequests, allowed: 'Request a', foreign: 'Request b' },
    { handler: exportTime, allowed: 'Time a', foreign: 'Time b' },
  ])('exports only assigned rows, even with foreign filters or privileged attribution', async ({ handler, allowed, foreign }) => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_member', orgId: 'org_tahi', sessionId: 'test',
      mcpActor: { teamMemberId: 'super', clerkUserId: 'user_super', profile: 'full' },
    })
    const response = await handler(req('GET'))
    expect(response.status).toBe(200)
    const csv = await response.text()
    expect(csv).toContain(allowed)
    expect(csv).not.toContain(foreign)
    expect((await (await handler(req('GET', undefined, `?orgId=${B}`))).text()).split('\n')).toHaveLength(1)
    await fixture.database.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, 'scope'))
    expect((await (await handler(req('GET'))).text()).split('\n')).toHaveLength(1)
    expect(fixture.errors).toEqual([])
  })
})

describe('audit requires permission management', () => {
  it('denies an ordinary scoped seat and allows the super admin', async () => {
    expect((await audit(req('GET'))).status).toBe(403)
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_super', orgId: 'org_tahi', sessionId: 'test' })
    const response = await audit(req('GET'))
    expect(response.status).toBe(200)
    expect((await response.json() as { items: Array<{ id: string }> }).items.map(item => item.id)).toEqual(['audit-1'])
  })

  it('keeps verified service authorization separate from the recorded scoped actor', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'api-service', orgId: 'org_tahi', sessionId: null,
      mcpActor: { teamMemberId: 'member', clerkUserId: 'user_member', profile: 'full' },
    })
    expect((await audit(req('GET'))).status).toBe(200)
    expect((await contacts.GET(req('GET'), { params: Promise.resolve({ id: B }) })).status).toBe(200)
  })
})

describe('T1.6 permission-granted seats still require the target client', () => {
  it.each([
    { handler: forms.GET, query: '?orgId=org-b', method: 'GET' },
    { handler: resolveForm, query: '?orgId=org-b', method: 'GET' },
    { handler: templates.GET, query: '?orgId=org-b', method: 'GET' },
    { handler: columns.GET, query: '?orgId=org-b', method: 'GET' },
    { handler: forms.POST, method: 'POST', body: { name: 'Foreign', orgId: B } },
    { handler: templates.POST, method: 'POST', body: { name: 'Foreign', orgId: B, type: 'client_task' } },
    { handler: columns.POST, method: 'POST', body: { label: 'Foreign', orgId: B } },
    { handler: columns.PATCH, method: 'PATCH', body: { positions: [{ id: 'column-b', position: 1 }] } },
    { handler: fromTemplate, method: 'POST', body: { templateId: 'template-b', orgId: A } },
    { handler: timers.POST, method: 'POST', body: { requestId: 'request-b' } },
    { handler: timers.POST, method: 'POST', body: { taskId: 'task-b' } },
    { handler: timers.POST, method: 'POST', body: { orgId: B } },
    { handler: stampInvoiced, method: 'POST', body: { orgId: B, before: '2026-10-14' } },
  ])('refuses $method on a foreign client before writing', async scenario => {
    const before = dataState()
    const response = await scenario.handler(req(scenario.method, scenario.body, scenario.query))
    expect(response.status).toBe(403)
    expect(dataState()).toEqual(before)
    expect(fixture.errors).toEqual([])
  })

  it.each([
    { handler: form.PATCH, id: 'form-b', method: 'PATCH', body: { name: 'Foreign' } },
    { handler: form.DELETE, id: 'form-b', method: 'DELETE' },
    { handler: column.PATCH, id: 'column-b', method: 'PATCH', body: { label: 'Foreign' } },
    { handler: column.DELETE, id: 'column-b', method: 'DELETE' },
    { handler: template.PATCH, id: 'template-b', method: 'PATCH', body: { name: 'Foreign' } },
    { handler: template.DELETE, id: 'template-b', method: 'DELETE' },
    { handler: subscription.GET, id: 'sub-b', method: 'GET' },
    { handler: subscription.PUT, id: 'sub-b', method: 'PUT', body: { discountPercent: 1 } },
    { handler: subscription.DELETE, id: 'sub-b', method: 'DELETE' },
    { handler: changeCycle, id: 'sub-b', method: 'POST', body: { newCycle: 'quarterly' } },
  ])('refuses $method for stored foreign target $id', async scenario => {
    const before = dataState()
    const response = await scenario.handler(req(scenario.method, scenario.body), { params: Promise.resolve({ id: scenario.id }) })
    expect(response.status).toBe(403)
    expect(dataState()).toEqual(before)
    expect(fixture.errors).toEqual([])
  })

  it('does not move a permitted form to a foreign client', async () => {
    const before = dataState()
    expect((await form.PATCH(req('PATCH', { orgId: B }), { params: Promise.resolve({ id: 'form-a' }) })).status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('filters the subscription index before returning any client names', async () => {
    const response = await subscriptions(req('GET'))
    expect(response.status).toBe(200)
    expect((await response.json() as { items: Array<{ orgId: string }> }).items.map(item => item.orgId)).toEqual([A])
  })

  it('requires permission management to grant or clear a project manager rule', async () => {
    for (const pmId of ['member', null]) {
      const before = dataState()
      expect((await pm.PUT(req('PUT', { pmId }), { params: Promise.resolve({ id: A }) })).status).toBe(403)
      expect(dataState()).toEqual(before)
    }
    for (const userId of ['user_super', 'api-service']) {
      vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId: 'org_tahi', sessionId: 'test' })
      expect((await pm.PUT(req('PUT', { pmId: 'member' }), { params: Promise.resolve({ id: A }) })).status).toBe(200)
    }
  })

  it('requires a real admin role for workspace-wide call-time repair', async () => {
    const before = dataState()
    expect((await normalizeTimes(req('POST', { dryRun: true }))).status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it.each([views, sectionViews])('refuses analytics on a foreign artifact and unknown resource kinds', async handler => {
    expect((await handler(req('GET', undefined, '?resourceType=proposal&resourceId=proposal-b'))).status).toBe(403)
    expect((await handler(req('GET', undefined, '?resourceType=unrecognised&resourceId=proposal-b'))).status).toBe(400)
    const response = await handler(req('GET', undefined, '?resourceType=proposal&resourceId=proposal-a'))
    expect(response.status).toBe(200)
    expect(fixture.errors).toEqual([])
  })

  it.each([
    { handler: timers.GET, method: 'GET' },
    { handler: pingTimer, method: 'POST' },
  ])('refuses $method for a timer after its client scope is revoked', async scenario => {
    fixture.insert(schema.activeTimers, { id: 'timer-b', user_id: 'user_member', request_id: 'request-b', org_id: B, started_at: '2026-10-14T00:00:00Z' })
    const before = dataState()
    expect((await scenario.handler(req(scenario.method))).status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it.each([
    { handler: timer.PATCH, method: 'PATCH', body: { action: 'pause' } },
    { handler: timer.DELETE, method: 'DELETE' },
  ])('refuses $method against a stored foreign timer', async scenario => {
    fixture.insert(schema.activeTimers, { id: 'timer-b', user_id: 'user_member', request_id: 'request-b', org_id: B, started_at: '2026-10-14T00:00:00Z' })
    const before = dataState()
    expect((await scenario.handler(req(scenario.method, scenario.body), { params: Promise.resolve({ id: 'timer-b' }) })).status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('does not return or auto-stop an existing foreign timer when starting permitted work', async () => {
    fixture.insert(schema.activeTimers, { id: 'timer-b', user_id: 'user_member', request_id: 'request-b', org_id: B, started_at: '2026-10-14T00:00:00Z' })
    const before = dataState()
    expect((await timers.POST(req('POST', { requestId: 'request-a' }, '?confirmed=true'))).status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('checks a timer client inherited from an org-less client task request', async () => {
    fixture.insert(schema.tasks, { id: 'inherited-task', org_id: null, type: 'internal_client_task', request_id: 'request-b' })
    const before = dataState()
    expect((await timers.POST(req('POST', { taskId: 'inherited-task' }))).status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('filters linked transcript clients before LIMIT, including conflicting call parents', async () => {
    for (const suffix of ['a', 'b']) fixture.insert(schema.callTranscripts, {
      id: `transcript-${suffix}`, call_kind: 'discovery', call_id: `call-${suffix}`, source: 'drive', external_id: suffix,
      text: suffix, received_at: '2026-10-13T00:00:00Z',
    })
    for (let index = 0; index < 25; index++) fixture.insert(schema.callTranscripts, {
      id: `foreign-transcript-${index}`, call_kind: 'discovery', call_id: 'call-b', source: 'drive', external_id: `foreign-${index}`,
      text: 'Foreign', received_at: '2099-01-01T00:00:00Z',
    })
    const response = await transcripts(req('GET', undefined, '?limit=1'))
    expect(response.status).toBe(200)
    expect((await response.json() as { items: Array<{ id: string }> }).items.map(item => item.id)).toEqual(['transcript-a'])
    await fixture.database.update(schema.discoveryCalls).set({ requestId: 'request-b' }).where(eq(schema.discoveryCalls.id, 'call-a'))
    expect((await transcripts(req('GET', undefined, '?limit=1'))).status).toBe(200)
    expect((await (await transcripts(req('GET', undefined, '?limit=1'))).json() as { items: unknown[] }).items).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it.each([callIndex, transcriptCalls])('filters every parent of discovery call list rows', async handler => {
    await fixture.database.update(schema.discoveryCalls).set({ requestId: 'request-b' }).where(eq(schema.discoveryCalls.id, 'call-a'))
    const response = await handler(req('GET', undefined, '?since=2026-01-01&until=2027-01-01'))
    expect(response.status).toBe(200)
    expect((await response.json() as { items: unknown[] }).items).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it.each(['GET', 'PATCH'] as const)('refuses transcript %s when any source call parent is foreign', async method => {
    fixture.insert(schema.callTranscripts, { id: 'transcript-a', call_kind: 'discovery', call_id: 'call-a', source: 'drive', external_id: 'a', text: 'Source' })
    await fixture.database.update(schema.discoveryCalls).set({ requestId: 'request-b' }).where(eq(schema.discoveryCalls.id, 'call-a'))
    const before = dataState()
    const response = await transcript[method](req(method, method === 'PATCH' ? { callKind: 'discovery', callId: 'call-a' } : undefined), { params: Promise.resolve({ id: 'transcript-a' }) })
    expect(response.status).toBe(403)
    expect(dataState()).toEqual(before)
    expect(fixture.errors).toEqual([])
  })

  it('refuses attaching permitted notes to a call with a foreign parent', async () => {
    fixture.insert(schema.callTranscripts, { id: 'transcript-a', source: 'drive', external_id: 'a', text: 'Source' })
    await fixture.database.update(schema.discoveryCalls).set({ requestId: 'request-b' }).where(eq(schema.discoveryCalls.id, 'call-a'))
    const before = dataState()
    expect((await transcript.PATCH(req('PATCH', { callKind: 'discovery', callId: 'call-a' }), { params: Promise.resolve({ id: 'transcript-a' }) })).status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('requires access to every contact added to a new conversation', async () => {
    const before = dataState()
    const response = await conversations.POST(req('POST', { type: 'group', visibility: 'internal', participantIds: [{ id: 'contact-b', type: 'contact' }] }))
    expect(response.status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it.each(['GET', 'POST', 'PATCH'] as const)('refuses conversation message %s with a foreign linked request', async method => {
    fixture.insert(schema.conversations, { id: 'conversation-a', org_id: A, request_id: 'request-b', type: 'request_thread', visibility: 'internal' })
    fixture.insert(schema.conversationParticipants, { id: 'participation', conversation_id: 'conversation-a', participant_id: 'member', participant_type: 'team_member' })
    const before = dataState()
    const response = await conversationMessages[method](req(method, method === 'POST' ? { content: 'Denied' } : method === 'PATCH' ? { messageId: 'message-a' } : undefined), { params: Promise.resolve({ id: 'conversation-a' }) })
    expect(response.status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('filters conversation requests before reading any message metadata', async () => {
    fixture.insert(schema.conversations, { id: 'conversation-a', org_id: A, request_id: 'request-b', type: 'request_thread', visibility: 'internal' })
    fixture.insert(schema.conversationParticipants, { id: 'participation', conversation_id: 'conversation-a', participant_id: 'member', participant_type: 'team_member' })
    const response = await conversations.GET(req('GET'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ conversations: [] })
    expect(fixture.errors).toEqual([])
  })

  it.each([taskBlockers.GET, taskDependencies.GET])('redacts request metadata when only the owning tasks feature is allowed', async handler => {
    await fixture.database.update(schema.requests).set({ title: 'Hidden request title', requestNumber: 321 }).where(eq(schema.requests.id, 'request-a'))
    fixture.insert(schema.workBlockers, { id: 'blocker', blocked_type: 'task', blocked_id: 'task-a', blocker_type: 'request', blocker_id: 'request-a' })
    denyFeature('requests')
    const response = await handler(req('GET'), { params: Promise.resolve({ id: 'task-a' }) })
    expect(response.status).toBe(200)
    const body = await response.json() as { blockedBy: Array<{ otherTitle?: string; taskTitle?: string; otherRef?: string | null; otherOrgName?: string | null; ref?: string | null }> }
    expect(body.blockedBy).toHaveLength(1)
    expect(body.blockedBy[0].otherTitle ?? body.blockedBy[0].taskTitle).toBe("Another client's work")
    expect(body.blockedBy[0].otherRef ?? body.blockedBy[0].ref ?? null).toBeNull()
    expect(JSON.stringify(body)).not.toContain('Hidden request title')
    expect(JSON.stringify(body)).not.toContain('321')
    expect(JSON.stringify(body)).not.toContain(A)
    expect(fixture.errors).toEqual([])
  })

  it('keeps the tasks picker available while excluding a denied request feature', async () => {
    await fixture.database.update(schema.requests).set({ title: 'Matching request' }).where(eq(schema.requests.id, 'request-a'))
    await fixture.database.update(schema.tasks).set({ title: 'Matching task' }).where(eq(schema.tasks.id, 'task-a'))
    denyFeature('requests')
    const response = await blockerSearch(req('GET', undefined, '?q=Matching'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ candidates: [{ type: 'task', id: 'task-a', label: 'Matching task' }] })
    expect(fixture.errors).toEqual([])
  })

  it('preserves full blocker metadata for the super admin and service caller', async () => {
    await fixture.database.update(schema.requests).set({ title: 'Allowed request title', requestNumber: 321 }).where(eq(schema.requests.id, 'request-b'))
    fixture.insert(schema.workBlockers, { id: 'blocker', blocked_type: 'task', blocked_id: 'task-a', blocker_type: 'request', blocker_id: 'request-b' })
    for (const userId of ['user_super', 'api-service']) {
      vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId: 'org_tahi', sessionId: 'test' })
      const response = await taskBlockers.GET(req('GET'), { params: Promise.resolve({ id: 'task-a' }) })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ blockedBy: [{ otherTitle: 'Allowed request title', otherOrgName: B }] })
    }
  })

  it('refuses single and bulk request participant writes naming foreign contacts', async () => {
    const before = dataState()
    expect((await requestParticipants.POST(req('POST', { participantId: 'contact-b', participantType: 'contact', role: 'follower' }), { params: Promise.resolve({ id: 'request-a' }) })).status).toBe(403)
    expect((await bulkAssign(req('POST', { requestIds: ['request-a'], participants: [{ participantId: 'contact-b', participantType: 'contact', role: 'follower' }] }))).status).toBe(403)
    expect(dataState()).toEqual(before)
  })

  it('redacts foreign contact metadata and foreign parent/child request titles', async () => {
    fixture.insert(schema.requestParticipants, { id: 'foreign-contact', request_id: 'request-a', participant_id: 'contact-b', participant_type: 'contact', role: 'follower' })
    await fixture.database.update(schema.requests).set({ parentRequestId: 'request-b' }).where(eq(schema.requests.id, 'request-a'))
    await fixture.database.update(schema.requests).set({ parentRequestId: 'request-a', title: 'Foreign child title' }).where(eq(schema.requests.id, 'request-b'))
    const response = await requestDetail(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ parent: null, subRequests: [], participants: [{ name: null, email: null }] })
    expect(await (await requestParticipants.GET(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })).json()).toMatchObject({ participants: [{ name: null, email: null }] })
    expect(await (await subRequests(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })).json()).toEqual({ subRequests: [] })
    expect(fixture.errors).toEqual([])
  })

  it('does not reorder a foreign request that carries a permitted parent id', async () => {
    await fixture.database.update(schema.requests).set({ parentRequestId: 'request-a', subPosition: 7 }).where(eq(schema.requests.id, 'request-b'))
    expect((await reorderSubRequests(req('PATCH', { order: [{ id: 'request-b', subPosition: 1 }] }), { params: Promise.resolve({ id: 'request-a' }) })).status).toBe(200)
    expect(fixture.rows(schema.requests).find(row => row.id === 'request-b')?.sub_position).toBe(7)
  })

  it('does not disclose a foreign contact name from a legacy handoff pointer', async () => {
    await fixture.database.update(schema.contacts).set({ name: 'Hidden foreign contact' }).where(eq(schema.contacts.id, 'contact-b'))
    await fixture.database.update(schema.requests).set({ waitingOnContactId: 'contact-b', waitingReason: 'approval', waitingSince: '2026-10-14T00:00:00Z' }).where(eq(schema.requests.id, 'request-a'))
    const response = await requestDetail(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })
    expect(response.status).toBe(200)
    const body = await response.json() as { request: { waitingOn: { contactName: string | null } } }
    expect(body.request.waitingOn.contactName).toBeNull()
    expect(JSON.stringify(body)).not.toContain('Hidden foreign contact')
  })

  it('refuses creating or moving a request step below another request parent', async () => {
    fixture.insert(schema.requestSteps, { id: 'step-a', request_id: 'request-a', title: 'Allowed' })
    fixture.insert(schema.requestSteps, { id: 'step-b', request_id: 'request-b', title: 'Foreign' })
    const before = dataState()
    expect((await requestSteps.POST(req('POST', { title: 'Invalid', parentStepId: 'step-b' }), { params: Promise.resolve({ id: 'request-a' }) })).status).toBe(404)
    expect((await requestStep.PATCH(req('PATCH', { parentStepId: 'step-b' }), { params: Promise.resolve({ id: 'request-a', stepId: 'step-a' }) })).status).toBe(404)
    expect(dataState()).toEqual(before)
  })

  it('keeps step-tree deletion inside the owning request even with a foreign child link', async () => {
    fixture.insert(schema.requestSteps, { id: 'step-a', request_id: 'request-a', title: 'Allowed' })
    fixture.insert(schema.requestSteps, { id: 'step-b', request_id: 'request-b', title: 'Foreign', parent_step_id: 'step-a' })
    expect((await requestStep.DELETE(req('DELETE'), { params: Promise.resolve({ id: 'request-a', stepId: 'step-a' }) })).status).toBe(200)
    expect(fixture.rows(schema.requestSteps).map(row => row.id)).toEqual(['step-b'])
  })

  it.each(['user_super', 'user_admin', 'api-service'])('keeps orphan timer reads, edits and deletion working for %s', async userId => {
    if (userId === 'user_admin') {
      fixture.insert(schema.roles, { id: 'role-admin', name: 'admin' })
      fixture.insert(schema.teamMembers, { id: 'admin', clerk_user_id: userId, name: 'Admin', role: 'admin' })
      fixture.insert(schema.teamMemberRoles, { id: 'admin-role', team_member_id: 'admin', role_id: 'role-admin', ended_at: null })
    }
    const owner = userId === 'api-service' ? 'user_member' : userId
    vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId: 'org_tahi', sessionId: 'test',
      ...(userId === 'api-service' ? { mcpActor: { teamMemberId: 'member', clerkUserId: 'user_member', profile: 'full' as const } } : {}),
    })
    fixture.insert(schema.activeTimers, { id: 'orphan', user_id: owner, task_id: 'deleted-task', org_id: B, started_at: '2026-10-14T00:00:00Z' })
    expect((await timers.GET(req('GET'))).status).toBe(200)
    expect((await timer.PATCH(req('PATCH', { action: 'pause' }), { params: Promise.resolve({ id: 'orphan' }) })).status).toBe(200)
    expect((await timer.DELETE(req('DELETE', undefined, '?action=discard'), { params: Promise.resolve({ id: 'orphan' }) })).status).toBe(200)
    expect(fixture.rows(schema.activeTimers)).toEqual([])
    expect((await timers.POST(req('POST', { taskId: 'deleted-task' }))).status).toBe(404)
    expect(fixture.errors).toEqual([])
  })

  it.each(['requestId', 'taskId'] as const)('filters a foreign time row that carries an allowed %s', async field => {
    fixture.insert(schema.timeEntries, { id: 'allowed-time', org_id: A, [field === 'requestId' ? 'request_id' : 'task_id']: field === 'requestId' ? 'request-a' : 'task-a', notes: 'Allowed time', hours: 1 })
    fixture.insert(schema.timeEntries, { id: 'foreign-time', org_id: B, [field === 'requestId' ? 'request_id' : 'task_id']: field === 'requestId' ? 'request-a' : 'task-a', notes: 'Hidden foreign time', hours: 99 })
    const response = await timeEntryList(req('GET', undefined, `?${field}=${field === 'requestId' ? 'request-a' : 'task-a'}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [{ id: 'allowed-time', hours: 1 }], totalHours: 1 })
    if (field === 'requestId') {
      const nested = await requestTimeEntryList(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })
      expect(nested.status).toBe(200)
      expect(await nested.json()).toMatchObject({ items: [{ id: 'allowed-time', hours: 1 }] })
    }
    expect(fixture.errors).toEqual([])
  })

  it('retains internal-task time while excluding foreign client entries, including an empty client scope', async () => {
    fixture.insert(schema.tasks, { id: 'studio-task', org_id: null, type: 'tahi_internal' })
    fixture.insert(schema.timeEntries, { id: 'studio-time', org_id: INTERNAL_ORG_ID, task_id: 'studio-task', notes: 'Studio time', hours: 1 })
    fixture.insert(schema.timeEntries, { id: 'foreign-time', org_id: B, task_id: 'studio-task', notes: 'Hidden foreign time', hours: 99 })
    await fixture.database.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, 'scope'))
    const response = await timeEntryList(req('GET', undefined, '?taskId=studio-task'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [{ id: 'studio-time', hours: 1 }], totalHours: 1 })
    expect(fixture.errors).toEqual([])
  })

  describe('message and attachment row ownership', () => {
    beforeEach(() => {
      fixture.insert(schema.conversations, { id: 'conversation-a', org_id: A, request_id: 'request-a', type: 'request_thread', visibility: 'internal' })
      fixture.insert(schema.conversationParticipants, { id: 'participation', conversation_id: 'conversation-a', participant_id: 'member', participant_type: 'team_member' })
      for (const [id, org, internal] of [['allowed-message', A, false], ['internal-message', A, true], ['foreign-message', B, false]] as const) {
        fixture.insert(schema.messages, { id, org_id: org, request_id: 'request-a', conversation_id: 'conversation-a', author_id: 'super', author_type: 'team_member', body: id, is_internal: internal ? 1 : 0, created_at: '2026-10-14T00:00:00Z' })
        fixture.insert(schema.voiceNotes, { id: `voice-${id}`, message_id: id, storage_key: `${id}.webm` })
      }
      fixture.insert(schema.files, { id: 'allowed-file', org_id: A, request_id: 'request-a', message_id: 'allowed-message', filename: 'Allowed', storage_key: 'allowed-key' })
      fixture.insert(schema.files, { id: 'foreign-file', org_id: B, request_id: 'request-a', message_id: 'allowed-message', filename: 'Hidden foreign file', storage_key: 'hidden-foreign-key' })
    })

    it('filters messages and attached file orgs while keeping internal request notes', async () => {
      const response = await requestMessages.GET(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })
      expect(response.status).toBe(200)
      const body = await response.json() as { items: Array<{ id: string; files: Array<{ id: string }> }> }
      expect(body.items.map(item => item.id).sort()).toEqual(['allowed-message', 'internal-message'])
      expect(body.items.find(item => item.id === 'allowed-message')?.files.map(file => file.id)).toEqual(['allowed-file'])
      expect(JSON.stringify(body)).not.toContain('foreign-message')
      expect(JSON.stringify(body)).not.toContain('hidden-foreign-key')
      expect(fixture.errors).toEqual([])
    })

    it('filters request files, voice-note messages and unread metadata by their own org', async () => {
      expect(await (await requestFiles(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })).json()).toMatchObject({ items: [{ id: 'allowed-file' }] })
      const voices = await requestVoiceNotes.GET(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })
      const body = await voices.json() as { items: Array<{ id: string }> }
      expect(body.items.map(item => item.id).sort()).toEqual(['voice-allowed-message', 'voice-internal-message'])
      expect(await (await requestDetail(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })).json()).toMatchObject({ unreadCount: 2 })
      expect(fixture.errors).toEqual([])
    })

    it('refuses a voice note write to a foreign message carrying an allowed request id', async () => {
      const before = dataState()
      expect((await requestVoiceNotes.POST(req('POST', { messageId: 'foreign-message', storageKey: 'new-key' }), { params: Promise.resolve({ id: 'request-a' }) })).status).toBe(404)
      expect(dataState()).toEqual(before)
    })

    it('filters conversation messages before pagination and refuses mutations on a foreign message row', async () => {
      const response = await conversationMessages.GET(req('GET'), { params: Promise.resolve({ id: 'conversation-a' }) })
      expect(response.status).toBe(200)
      const body = await response.json() as { items: Array<{ id: string }> }
      expect(body.items.map(item => item.id).sort()).toEqual(['allowed-message', 'internal-message'])
      const before = dataState()
      expect((await conversationMessages.PATCH(req('PATCH', { messageId: 'foreign-message', deleted: true }), { params: Promise.resolve({ id: 'conversation-a' }) })).status).toBe(404)
      expect(dataState()).toEqual(before)
      expect(fixture.errors).toEqual([])
    })

    it('filters conversation index previews and unread counts by each message org', async () => {
      await fixture.database.update(schema.messages).set({ createdAt: '2099-01-01T00:00:00Z' }).where(eq(schema.messages.id, 'foreign-message'))
      const response = await conversations.GET(req('GET'))
      expect(response.status).toBe(200)
      const body = await response.json() as { conversations: Array<{ unreadCount: number; lastMessage: { body: string } }> }
      expect(body.conversations[0].unreadCount).toBe(2)
      expect(body.conversations[0].lastMessage.body).not.toBe('foreign-message')
      expect(fixture.errors).toEqual([])
    })

    it('preserves studio-internal conversation messages stored under the Tahi org', async () => {
      await fixture.database.update(schema.conversations).set({ orgId: null, requestId: null }).where(eq(schema.conversations.id, 'conversation-a'))
      fixture.insert(schema.messages, { id: 'studio-message', org_id: 'org_tahi', conversation_id: 'conversation-a', author_id: 'member', author_type: 'team_member', body: 'Studio note', is_internal: 1 })
      const response = await conversationMessages.GET(req('GET'), { params: Promise.resolve({ id: 'conversation-a' }) })
      expect(response.status).toBe(200)
      expect((await response.json() as { items: Array<{ id: string }> }).items.map(item => item.id).sort()).toEqual(['allowed-message', 'internal-message', 'studio-message'])
      expect(fixture.errors).toEqual([])
    })

    it('holds the shared inbox thread reader to its resolved org before LIMIT', async () => {
      for (let index = 0; index < 5; index++) fixture.insert(schema.messages, { id: `foreign-new-${index}`, org_id: B, request_id: 'request-a', author_id: 'member', author_type: 'team_member', body: 'Hidden newest message', created_at: '2099-01-01T00:00:00Z' })
      const items = await loadThreadMessages(fixture.database, { source: 'request', id: 'request-a', orgId: A, viewer: { clerkUserId: 'user_member', domainId: 'member', userType: 'team_member' }, audience: 'studio', limit: 1 })
      expect(items).toHaveLength(1)
      expect(items[0].body).not.toContain('Hidden')
      expect(items[0].body).not.toBe('foreign-message')
      expect(fixture.errors).toEqual([])
    })

    it.each(['request', 'channel'] as const)('filters %s inbox preview rows by each message org', async source => {
      if (source === 'channel') await fixture.database.update(schema.messages).set({ requestId: null }).where(eq(schema.messages.conversationId, 'conversation-a'))
      await fixture.database.update(schema.messages).set({ createdAt: '2099-01-01T00:00:00Z', body: 'Hidden newest body' }).where(eq(schema.messages.id, 'foreign-message'))
      const result = await loadInboxThreads(fixture.database, {
        viewer: { clerkUserId: 'user_member', domainId: 'member', userType: 'team_member' },
        scope: { orgIds: [A], brandIds: null, audience: 'studio' },
        channelsByOrg: source === 'channel' ? new Map([[A, 'conversation-a']]) : new Map(),
        orgNames: new Map([[A, A]]), now: new Date('2026-10-14T00:00:00Z'),
      })
      const thread = result.threads.find(item => item.source === source)
      expect(thread?.unreadCount).toBe(2)
      expect(JSON.stringify(thread)).not.toContain('Hidden newest body')
      expect(fixture.errors).toEqual([])
    })

    it('does not expose foreign contact-author names on an allowed message or inbox preview', async () => {
      await fixture.database.update(schema.contacts).set({ name: 'Hidden foreign author' }).where(eq(schema.contacts.id, 'contact-b'))
      await fixture.database.update(schema.messages).set({ authorId: 'contact-b', authorType: 'contact', createdAt: '2099-01-01T00:00:00Z' }).where(eq(schema.messages.id, 'allowed-message'))
      const viewer = { clerkUserId: 'user_member', domainId: 'member', userType: 'team_member' as const }
      const items = await loadThreadMessages(fixture.database, { source: 'request', id: 'request-a', orgId: A, viewer, audience: 'studio' })
      expect(items.find(item => item.id === 'allowed-message')?.authorName).toBeNull()
      const inbox = await loadInboxThreads(fixture.database, { viewer, scope: { orgIds: [A], brandIds: null, audience: 'studio' }, channelsByOrg: new Map(), orgNames: new Map([[A, A]]), now: new Date('2026-10-14T00:00:00Z') })
      expect(JSON.stringify(inbox)).not.toContain('Hidden foreign author')
      expect(fixture.errors).toEqual([])
    })

    it('refuses posting an allowed request message into a foreign conversation', async () => {
      fixture.insert(schema.conversations, { id: 'conversation-b', org_id: B, request_id: 'request-b', type: 'request_thread', visibility: 'external' })
      const before = dataState()
      expect((await requestMessages.POST(req('POST', { body: 'Denied', conversationId: 'conversation-b' }), { params: Promise.resolve({ id: 'request-a' }) })).status).toBe(403)
      expect(dataState()).toEqual(before)
    })

    it.each(['user_super', 'api-service'])('preserves unrestricted request metadata access for %s', async userId => {
      vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId: 'org_tahi', sessionId: 'test' })
      const response = await requestMessages.GET(req('GET'), { params: Promise.resolve({ id: 'request-a' }) })
      expect(response.status).toBe(200)
      expect((await response.json() as { items: Array<{ id: string }> }).items.map(item => item.id).sort()).toEqual(['allowed-message', 'foreign-message', 'internal-message'])
    })

    it.each(['user_super', 'api-service'])('keeps legacy message rows visible to authenticated unrestricted %s, independently of the recorded viewer', async userId => {
      const orgScope = await scopedOrgIds({ userId, orgId: 'org_tahi' })
      const viewer = { clerkUserId: 'user_member', domainId: 'member', userType: 'team_member' as const }
      const thread = await loadThreadMessages(fixture.database, { source: 'request', id: 'request-a', orgId: A, viewer, audience: 'studio', orgScope })
      expect(thread.map(item => item.id).sort()).toEqual(['allowed-message', 'foreign-message', 'internal-message'])
      await fixture.database.update(schema.messages).set({ createdAt: '2099-01-01T00:00:00Z', body: 'Legacy foreign preview' }).where(eq(schema.messages.id, 'foreign-message'))
      const inbox = await loadInboxThreads(fixture.database, { viewer, scope: { orgIds: [A], brandIds: null, audience: 'studio', orgScope }, channelsByOrg: new Map(), orgNames: new Map([[A, A]]), now: new Date('2026-10-14T00:00:00Z') })
      expect(JSON.stringify(inbox)).toContain('Legacy foreign preview')
      const clientThread = await loadThreadMessages(fixture.database, { source: 'request', id: 'request-a', orgId: A, viewer: { clerkUserId: 'client-user', domainId: null, userType: 'contact' }, audience: 'client', orgScope })
      expect(clientThread.map(item => item.id)).toEqual(['allowed-message'])
    })
  })
})
