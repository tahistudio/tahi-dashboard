import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: vi.fn(), currentUser: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(), isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/billing-derivation', () => ({ applyBillingDerivation: vi.fn() }))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ createNotifications: vi.fn() }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { applyBillingDerivation } from '@/lib/billing-derivation'
import { POST as time } from '@/app/api/admin/time/route'
import { POST as entries } from '@/app/api/admin/time-entries/route'
import * as requestEntries from '@/app/api/admin/requests/[id]/time-entries/route'
import { GET as clients } from '@/app/api/admin/clients/route'
import * as client from '@/app/api/admin/clients/[id]/route'
import { GET as retainerHealth } from '@/app/api/admin/reports/retainer-health/route'
import { POST as retainerAlerts } from '@/app/api/admin/reports/retainer-alerts/route'
import { GET as resolveForm } from '@/app/api/admin/forms/resolve/route'

const TABLES = [
  schema.roles, schema.permissions, schema.rolePermissions, schema.teamMembers, schema.teamMemberRoles,
  schema.featureVisibility, schema.teamMemberAccess, schema.teamMemberAccessOrgs, schema.organisations,
  schema.requests, schema.timeEntries, schema.tasks, schema.contacts, schema.subscriptions, schema.tracks,
  schema.settings, schema.exchangeRates, schema.notifications, schema.requestForms,
]
let fixture: ReturnType<typeof permissionSqlite>
function use(role: string) {
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: role === 'api-service' ? role : `user_${role}`, orgId: 'org_tahi', sessionId: 'test' })
}
function request(method: string, body?: object, query = '') {
  return new NextRequest(`http://localhost/api/admin/test${query}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}
const params = { params: Promise.resolve({ id: 'request-a' }) }
const clientParams = { params: Promise.resolve({ id: 'org-a' }) }
const resources = ['leads', 'deals', 'contacts', 'people', 'organisations', 'requests', 'tasks', 'messages', 'files', 'time_entries', 'invoices', 'contracts', 'proposals', 'schedules', 'calls', 'activities', 'docs', 'subscribers', 'campaigns', 'affiliates', 'reports', 'sales_analytics', 'settings', 'team', 'integrations', 'calculator', 'announcements']

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  fixture = permissionSqlite(TABLES, [
    'ALTER TABLE organisations ADD COLUMN custom_mrr integer',
    'ALTER TABLE organisations ADD COLUMN custom_mrr_currency text',
    'ALTER TABLE organisations ADD COLUMN billing_model text',
    'ALTER TABLE organisations ADD COLUMN retainer_start_date text',
    'ALTER TABLE organisations ADD COLUMN retainer_end_date text',
    'ALTER TABLE organisations ADD COLUMN billing_model_is_manual integer',
    'ALTER TABLE organisations ADD COLUMN retainer_dates_is_manual integer',
    'ALTER TABLE organisations ADD COLUMN custom_mrr_is_manual integer',
  ])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  for (const role of ['viewer', 'project_manager', 'admin', 'super_admin']) {
    const roleId = `role-${role.replaceAll('_', '-')}`
    fixture.insert(schema.roles, { id: roleId, name: role, is_system: 1 })
    fixture.insert(schema.teamMembers, { id: role, clerk_user_id: `user_${role}`, name: role, role: role.endsWith('admin') ? 'admin' : 'member' })
    fixture.insert(schema.teamMemberRoles, { id: `${role}-role`, team_member_id: role, role_id: roleId, ended_at: null })
    fixture.insert(schema.teamMemberAccess, { id: `${role}-scope`, team_member_id: role, role: 'viewer', scope_type: 'specific_clients', track_type: 'all' })
    fixture.insert(schema.teamMemberAccessOrgs, { access_id: `${role}-scope`, org_id: 'org-a' })
  }
  // Migration 0041's viewer takes every catalogue view row. The PM has CRM,
  // time and reports reads, while settings remains unavailable to its baseline.
  for (const resource of resources) {
    fixture.insert(schema.permissions, { id: `${resource}.view`, resource, action: 'view' })
    for (const role of ['viewer', 'project_manager']) {
      if (role === 'project_manager' && ['settings', 'integrations', 'campaigns', 'subscribers', 'affiliates', 'announcements', 'files'].includes(resource)) continue
      fixture.insert(schema.rolePermissions, { id: `${role}-${resource}`, role_id: `role-${role.replaceAll('_', '-')}`, permission_id: `${resource}.view`, scope_type: 'all' })
    }
  }
  for (const id of ['org-a', 'org-b']) fixture.insert(schema.organisations, {
    id, name: id, status: 'paused', plan_type: 'maintain', created_at: new Date().toISOString(),
    default_hourly_rate: 180, stripe_customer_id: 'cus_secret', xero_contact_id: 'xero_secret',
    internal_notes: 'Internal secret', custom_mrr: 1200, custom_mrr_currency: 'NZD', billing_model: 'retainer',
  })
  fixture.insert(schema.requests, { id: 'request-a', org_id: 'org-a', title: 'Work', status: 'submitted' })
  fixture.insert(schema.requests, { id: 'request-b', org_id: 'org-b', title: 'Foreign', status: 'submitted' })
  fixture.insert(schema.subscriptions, { id: 'sub-a', org_id: 'org-a', status: 'active', plan_type: 'maintain', stripe_subscription_id: 'sub_secret' })
  fixture.insert(schema.exchangeRates, { currency: 'NZD', rate_to_usd: 1 })
  fixture.insert(schema.requestForms, { id: 'form-a', org_id: 'org-a', name: 'Intake', questions: '[]' })
  use('project_manager')
})
afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

const writes = [
  { name: 'time', run: (body: object) => time(request('POST', body)), base: { orgId: 'org-a', requestId: 'request-a', hours: 1, date: '2026-10-14' } },
  { name: 'time-entries', run: (body: object) => entries(request('POST', body)), base: { requestId: 'request-a', hours: 1, date: '2026-10-14' } },
  { name: 'request time-entries', run: (body: object) => requestEntries.POST(request('POST', body), params), base: { hours: 1 } },
]
describe.each(writes)('$name ownership and client integrity', scenario => {
  it('forces a scoped caller as logger and ignores the supplied rate and actor', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_project_manager', orgId: 'org_tahi', sessionId: 'test',
      mcpActor: { clerkUserId: 'user_super_admin', teamMemberId: 'super_admin', profile: 'full' },
    })
    const result = await scenario.run({ ...scenario.base, teamMemberId: 'super_admin', hourlyRate: 999 })
    expect(result.status).toBe(scenario.name === 'time-entries' ? 201 : 200)
    expect(fixture.rows(schema.timeEntries)).toHaveLength(1)
    expect(fixture.rows(schema.timeEntries)[0]).toMatchObject({ team_member_id: 'project_manager', hourly_rate: 180, org_id: 'org-a' })
  })
  it.each(['admin', 'super_admin', 'api-service'])('preserves explicit member and rate for %s', async role => {
    use(role)
    const result = await scenario.run({ ...scenario.base, teamMemberId: 'viewer', hourlyRate: 250 })
    expect(result.status).toBe(scenario.name === 'time-entries' ? 201 : 200)
    expect(fixture.rows(schema.timeEntries)[0]).toMatchObject({ team_member_id: 'viewer', hourly_rate: 250 })
  })
  it('rejects a mismatching org before any time write', async () => {
    expect((await scenario.run({ ...scenario.base, orgId: 'org-b', teamMemberId: 'project_manager' })).status).toBe(400)
    expect(fixture.rows(schema.timeEntries)).toEqual([])
  })
})

describe('request time and intake feature gates', () => {
  it.each(['requests', 'time'])('requires %s for both request time handlers', async feature => {
    fixture.insert(schema.featureVisibility, { id: 'deny', subject_type: 'team_member', subject_id: 'project_manager', feature_key: feature, effect: 'deny' })
    expect((await requestEntries.GET(request('GET'), params)).status).toBe(403)
    expect((await requestEntries.POST(request('POST', { hours: 1 }), params)).status).toBe(403)
    expect(fixture.rows(schema.timeEntries)).toEqual([])
  })
  it('derives the client when only a request is supplied to time', async () => {
    expect((await time(request('POST', { requestId: 'request-a', hours: 1, date: '2026-10-14' }))).status).toBe(200)
    expect(fixture.rows(schema.timeEntries)[0].org_id).toBe('org-a')
  })
  it('lets a request member resolve intake without settings access', async () => {
    const result = await resolveForm(request('GET', undefined, '?orgId=org-a'))
    expect(result.status).toBe(200)
    expect(await result.json()).toHaveProperty('form.id', 'form-a')
  })
})

describe('billing projections and writes', () => {
  function denyBilling() {
    fixture.insert(schema.featureVisibility, { id: 'billing-denied', subject_type: 'team_member', subject_id: 'project_manager', feature_key: 'clients.billing_card', effect: 'deny' })
  }
  it('redacts general list and detail including subscription processor IDs', async () => {
    denyBilling()
    for (const response of [await clients(request('GET')), await client.GET(request('GET'), clientParams)]) {
      expect(response.status).toBe(200)
      const text = JSON.stringify(await response.json())
      for (const field of ['customMrr', 'billingModel', 'defaultHourlyRate', 'stripeCustomerId', 'xeroContactId', 'internalNotes', 'stripeSubscriptionId']) expect(text).not.toContain(field)
    }
    expect(applyBillingDerivation).not.toHaveBeenCalled()
  })
  it.each(['customMrr', 'billingModel', 'defaultHourlyRate', 'internalNotes', 'stripeCustomerId', 'xeroContactId'])('refuses a protected %s write', async field => {
    denyBilling()
    const before = fixture.rows(schema.organisations)
    expect((await client.PATCH(request('PATCH', { [field]: 'changed' }), clientParams)).status).toBe(403)
    expect(fixture.rows(schema.organisations)).toEqual(before)
  })
  it.each(['admin', 'super_admin', 'api-service'])('preserves billing reads and writes for %s', async role => {
    use(role)
    const detail = await client.GET(request('GET'), clientParams)
    expect(detail.status).toBe(200)
    expect(await detail.json()).toHaveProperty('org.customMrr', 1200)
    expect(applyBillingDerivation).toHaveBeenCalledWith(fixture.database, 'org-a')
    expect((await client.PATCH(request('PATCH', { customMrr: 1400, defaultHourlyRate: 250 }), clientParams)).status).toBe(200)
    expect(fixture.rows(schema.organisations).find(row => row.id === 'org-a')).toMatchObject({ custom_mrr: 1400, default_hourly_rate: 250 })
  })
  it('operational retainer reports omit money without financial_reports', async () => {
    for (const response of [await retainerHealth(request('GET')), await retainerAlerts(request('POST'))]) {
      expect(response.status).toBe(200)
      expect(JSON.stringify(await response.json())).not.toContain('mrrNzd')
    }
  })
  it.each(['admin', 'super_admin', 'api-service'])('keeps money in retainer reports for %s', async role => {
    use(role)
    const health = await retainerHealth(request('GET'))
    expect(health.status).toBe(200)
    expect(await health.json()).toHaveProperty('clients.0.mrrNzd', 1200)
    const alerts = await retainerAlerts(request('POST'))
    expect(alerts.status).toBe(200)
    expect(await alerts.json()).toHaveProperty('alerts.0.mrrNzd', 1200)
  })
})
