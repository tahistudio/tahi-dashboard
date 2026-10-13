import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
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
import * as activities from '@/app/api/admin/activities/route'
import * as activity from '@/app/api/admin/activities/[id]/route'
import { PUT as reorder } from '@/app/api/admin/tracks/[trackId]/reorder/route'
import { GET as delivery } from '@/app/api/admin/engagements/delivery-status/route'
import { GET as offTrack } from '@/app/api/admin/engagements/off-track/route'
import { GET as audit } from '@/app/api/admin/audit/route'

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
  schema.auditLog,
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
  for (const resource of ['organisations', 'requests', 'schedules', 'deals', 'leads']) {
    fixture.insert(schema.permissions, { id: resource, resource, action: 'view' })
    fixture.insert(schema.rolePermissions, { id: resource, role_id: 'role-member', permission_id: resource })
  }
  fixture.insert(schema.teamMemberAccess, { id: 'scope', team_member_id: 'member', role: 'task_handler', scope_type: 'specific_clients' })
  fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'scope', org_id: A })
  for (const [org, suffix] of [[A, 'a'], [B, 'b']] as const) {
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
  { name: 'pm PUT', method: 'PUT', handler: pm.PUT, feature: 'clients', id: suffix => `org-${suffix}`, body: { pmId: 'member' } },
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
