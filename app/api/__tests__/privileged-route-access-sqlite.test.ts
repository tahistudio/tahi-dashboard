import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: vi.fn(), auth: vi.fn(), currentUser: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(), isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/xero', () => ({ callXeroAPI: vi.fn().mockResolvedValue({ Accounts: [], Reports: [] }) }))
vi.mock('@/lib/buffer', () => ({
  createPost: vi.fn().mockResolvedValue({ id: 'buffer-post' }),
  listChannels: vi.fn().mockResolvedValue([]), listOrganizations: vi.fn().mockResolvedValue([]),
}))
vi.mock('stripe', () => ({ default: class {
  customers = { create: vi.fn().mockResolvedValue({ id: 'cus_fixture' }) }
  invoices = { retrieve: vi.fn().mockResolvedValue({ hosted_invoice_url: 'https://example.test/invoice' }) }
  prices = {
    list: vi.fn().mockResolvedValue({ data: [{ id: 'price_fixture' }] }),
    update: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({ id: 'price_fixture' }),
  }
  products = {
    search: vi.fn().mockResolvedValue({ data: [{ id: 'product_fixture' }] }),
    create: vi.fn().mockResolvedValue({ id: 'product_fixture' }),
  }
} }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import * as webhooks from '@/app/api/admin/webhooks/route'
import { GET as googleStart } from '@/app/api/admin/integrations/google/start/route'
import { GET as xeroConnect } from '@/app/api/admin/integrations/xero/connect/route'
import * as slack from '@/app/api/admin/integrations/slack/route'
import * as provision from '@/app/api/admin/integrations/stripe/provision/route'
import * as plans from '@/app/api/admin/integrations/stripe/setup-plans/route'
import * as zapier from '@/app/api/admin/integrations/zapier/route'
import * as mailerlite from '@/app/api/admin/integrations/mailerlite/route'
import * as rewardful from '@/app/api/admin/integrations/rewardful/route'
import { POST as schedulePosts } from '@/app/api/admin/integrations/buffer/schedule-posts/route'
import { GET as profitLoss } from '@/app/api/admin/integrations/xero/profit-loss/route'
import { GET as balanceSheet } from '@/app/api/admin/integrations/xero/balance-sheet/route'
import { GET as bankSummary } from '@/app/api/admin/integrations/xero/bank-summary/route'
import * as invites from '@/app/api/admin/onboarding-invites/route'
import * as stages from '@/app/api/admin/pipeline/stages/route'
import { DELETE as deleteStage } from '@/app/api/admin/pipeline/stages/[id]/route'
import { POST as seedPipeline } from '@/app/api/admin/pipeline/seed/route'
import { GET as suppressions } from '@/app/api/admin/email-suppressions/route'
import { POST as assignRole } from '@/app/api/admin/permissions/assign-role/route'
import { POST as copyAccess } from '@/app/api/admin/permissions/copy-access/route'
import * as team from '@/app/api/admin/team/[id]/route'
import { acquireOwnerMutationLock } from '@/lib/super-admin-safety'
import * as ownerSafety from '@/lib/super-admin-safety'

const TABLES = [
  schema.roles, schema.permissions, schema.rolePermissions, schema.teamMembers,
  schema.teamMemberRoles, schema.featureVisibility, schema.teamMemberAccess,
  schema.teamMemberAccessOrgs, schema.settings, schema.integrations, schema.organisations,
  schema.requests, schema.invoices, schema.onboardingInvites, schema.pipelineStages,
  schema.deals, schema.auditLog, schema.emailSuppressions, schema.contacts,
]
let fixture: ReturnType<typeof permissionSqlite>
type Role = 'viewer' | 'project_manager' | 'admin' | 'super_admin' | 'api-service'

function as(role: Role) {
  vi.mocked(getRequestAuth).mockResolvedValue({
    userId: role === 'api-service' ? role : `user_${role}`, orgId: 'org_tahi', sessionId: 'test',
  })
}
function req(method: string, body?: object, query = '') {
  return new NextRequest(`https://portal.example.test/api/admin/test${query}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}
const context = (id: string) => ({ params: Promise.resolve({ id }) })
const state = () => TABLES.map(table => fixture.rows(table))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.stubEnv('GOOGLE_CLIENT_ID', 'google_fixture')
  vi.stubEnv('XERO_CLIENT_ID', 'xero_fixture')
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture')
  vi.stubEnv('BUFFER_API_KEY', 'buffer_fixture')
  fixture = permissionSqlite(TABLES, ['CREATE UNIQUE INDEX settings_key_unique ON settings (key)'])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  for (const role of ['viewer', 'project_manager', 'admin', 'super_admin']) {
    fixture.insert(schema.roles, { id: `role-${role}`, name: role, is_system: 1 })
    fixture.insert(schema.teamMembers, {
      id: role, name: role, email: `${role}@example.test`, clerk_user_id: `user_${role}`,
      role: role === 'admin' || role === 'super_admin' ? 'admin' : 'member',
    })
    fixture.insert(schema.teamMemberRoles, {
      id: `${role}-assignment`, team_member_id: role, role_id: `role-${role}`, ended_at: null,
    })
  }
  // Migration 0041 grants the viewer every .view permission. The manager has
  // CRM, team and billing reads, with no settings or integrations baseline.
  for (const resource of ['settings', 'integrations', 'organisations', 'requests', 'deals', 'team', 'invoices', 'calls']) {
    fixture.insert(schema.permissions, { id: `${resource}.view`, resource, action: 'view' })
    fixture.insert(schema.rolePermissions, {
      id: `viewer:${resource}`, role_id: 'role-viewer', permission_id: `${resource}.view`, scope_type: 'all',
    })
    if (!['settings', 'integrations'].includes(resource)) {
      fixture.insert(schema.rolePermissions, {
        id: `manager:${resource}`, role_id: 'role-project_manager', permission_id: `${resource}.view`, scope_type: 'all',
      })
    }
  }
  for (const role of ['viewer', 'project_manager']) {
    fixture.insert(schema.teamMemberAccess, {
      id: `${role}-scope`, team_member_id: role, role, scope_type: 'specific_clients', track_type: 'all',
    })
    fixture.insert(schema.teamMemberAccessOrgs, { access_id: `${role}-scope`, org_id: 'org-a' })
  }
  fixture.insert(schema.organisations, { id: 'org-a', name: 'Assigned client', plan_type: 'maintain' })
  fixture.insert(schema.requests, { id: 'request-a', org_id: 'org-a', title: 'Fixture request' })
  fixture.insert(schema.invoices, { id: 'invoice-a', org_id: 'org-a', stripe_invoice_id: 'in_fixture' })
  fixture.insert(schema.pipelineStages, { id: 'stage-a', name: 'Custom', slug: 'custom', position: 0 })
  fixture.insert(schema.settings, {
    key: 'webhook_endpoint_hook-a', value: JSON.stringify({
      id: 'hook-a', url: 'https://example.test/hook', secret: 'once-only-secret', events: ['request_created'],
      active: true, createdAt: '2026-10-14T00:00:00Z',
    }),
  })
  as('viewer')
})
afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

const CASES: Array<{ name: string; call: () => Promise<Response>; status?: number }> = [
  { name: 'webhooks GET', call: () => webhooks.GET(req('GET')) },
  { name: 'webhooks POST', call: () => webhooks.POST(req('POST', { url: 'https://example.test/new', secret: 'creation-secret', events: ['request_created'] })), status: 201 },
  { name: 'webhooks PATCH', call: () => webhooks.PATCH(req('PATCH', { id: 'hook-a', active: false })) },
  { name: 'webhooks DELETE', call: () => webhooks.DELETE(req('DELETE', undefined, '?id=hook-a')) },
  { name: 'google/start GET', call: () => googleStart(req('GET')) },
  { name: 'xero/connect GET', call: () => xeroConnect(req('GET')) },
  { name: 'slack POST', call: () => slack.POST(req('POST', { channel: 'fixture', message: 'Fixture' })) },
  { name: 'slack PUT', call: () => slack.PUT(req('PUT', { channels: { new_request: 'fixture' } })) },
  { name: 'stripe/provision POST', call: () => provision.POST(req('POST', { orgId: 'org-a', planType: 'maintain' })) },
  { name: 'stripe/provision GET', call: () => provision.GET(req('GET', undefined, '?invoiceId=invoice-a')) },
  { name: 'stripe/setup-plans POST', call: () => plans.POST(req('POST')) },
  { name: 'stripe/setup-plans GET', call: () => plans.GET(req('GET')) },
  { name: 'zapier GET', call: () => zapier.GET(req('GET')) },
  { name: 'zapier POST', call: () => zapier.POST(req('POST', { action: 'create_request', orgId: 'org-a', title: 'New request' })) },
  { name: 'mailerlite GET', call: () => mailerlite.GET(req('GET')) },
  { name: 'mailerlite PUT', call: () => mailerlite.PUT(req('PUT', { email: 'fixture@example.test', action: 'unsubscribe' })) },
  { name: 'mailerlite POST', call: () => mailerlite.POST(req('POST', { email: 'fixture@example.test' })) },
  { name: 'rewardful GET', call: () => rewardful.GET(req('GET')) },
  { name: 'rewardful POST', call: () => rewardful.POST(req('POST', { apiKey: 'fixture' })) },
  { name: 'buffer/schedule-posts POST', call: () => schedulePosts(req('POST', { posts: [{ text: 'Fixture' }], channelId: 'fixture', schedule: { mode: 'queue' } })) },
  { name: 'xero/profit-loss GET', call: () => profitLoss(req('GET')) },
  { name: 'xero/balance-sheet GET', call: () => balanceSheet(req('GET')) },
  { name: 'xero/bank-summary GET', call: () => bankSummary(req('GET')) },
  { name: 'onboarding-invites POST', call: () => invites.POST(req('POST', { orgId: 'org-a', contactEmail: 'invitee@example.test' })) },
  { name: 'pipeline/stages POST', call: () => stages.POST(req('POST', { name: 'New stage' })), status: 201 },
  { name: 'pipeline/stages PUT', call: () => stages.PUT(req('PUT', { stages: [{ id: 'stage-a', name: 'Updated' }] })) },
  { name: 'pipeline/stages DELETE', call: () => deleteStage(req('DELETE'), context('stage-a')) },
  { name: 'pipeline/seed POST', call: () => seedPipeline(req('POST')) },
  { name: 'email-suppressions GET', call: () => suppressions(req('GET')) },
  { name: 'assign-role POST', call: () => assignRole(req('POST', { teamMemberId: 'viewer', roleId: 'role-project_manager' })) },
  { name: 'copy-access POST', call: () => copyAccess(req('POST', { subjectType: 'team_member', sourceId: 'viewer', targetId: 'project_manager' })) },
  { name: 'team PUT', call: () => team.PUT(req('PUT', { title: 'Updated title' }), context('viewer')) },
  { name: 'team DELETE', call: () => team.DELETE(req('DELETE'), context('viewer')) },
]

describe.each(CASES)('$name uses role and feature guards', scenario => {
  it.each(['viewer', 'project_manager'] as const)('refuses a real %s before writes', async role => {
    as(role)
    const before = state()
    expect((await scenario.call()).status).toBe(403)
    expect(state()).toEqual(before)
    expect(fixture.errors).toEqual([])
  })
  it.each(['admin', 'super_admin', 'api-service'] as const)('keeps %s working', async role => {
    as(role)
    expect((await scenario.call()).status).toBe(scenario.status ?? 200)
    expect(fixture.errors).toEqual([])
  })
})

describe('once-only secrets', () => {
  it('discloses the webhook secret on creation, then redacts GET and PATCH', async () => {
    as('admin')
    const created = await webhooks.POST(req('POST', { url: 'https://example.test/new', secret: 'creation-secret', events: ['request_created'] }))
    expect(await created.json()).toMatchObject({ endpoint: { secret: 'creation-secret' } })
    const listed = await webhooks.GET(req('GET'))
    expect(JSON.stringify(await listed.json())).not.toContain('secret')
    const edited = await webhooks.PATCH(req('PATCH', { id: 'hook-a', active: false }))
    expect(JSON.stringify(await edited.json())).not.toContain('secret')
    expect(fixture.rows(schema.settings).some(row => String(row.value).includes('once-only-secret'))).toBe(true)
  })
  it('omits invite token and link from list results, including for viewer reads', async () => {
    fixture.insert(schema.onboardingInvites, { id: 'invite-a', token: 'hidden-invite-token', org_id: 'org-a', flow: 'client' })
    const response = await invites.GET(req('GET', undefined, '?orgId=org-a'))
    expect(response.status).toBe(200)
    const result = await response.json() as { invites: Array<Record<string, unknown>> }
    expect(result.invites).toHaveLength(1)
    expect(result.invites[0]).not.toHaveProperty('token')
    expect(result.invites[0]).not.toHaveProperty('link')
  })
})

describe('owner protections', () => {
  it.each([null, '', '   '])('keeps one usable owner after sequential unlink attempts using %j', async clerkUserId => {
    as('super_admin')
    fixture.insert(schema.teamMemberRoles, { id: 'second-owner', team_member_id: 'admin', role_id: 'role-super_admin', ended_at: null })
    expect((await team.PUT(req('PUT', { clerkUserId }), context('admin'))).status).toBe(200)
    expect(fixture.rows(schema.teamMembers).find(row => row.id === 'admin')).toMatchObject({ clerk_user_id: null })
    const before = state()
    expect((await team.PUT(req('PUT', { clerkUserId }), context('super_admin'))).status).toBe(409)
    expect(state()).toEqual(before)
  })
  it.each([null, '', '   '])('does not count an owner with login %j as a usable fallback', async clerkUserId => {
    as('super_admin')
    fixture.insert(schema.teamMemberRoles, { id: 'second-owner', team_member_id: 'admin', role_id: 'role-super_admin', ended_at: null })
    fixture.sqlite.prepare('UPDATE team_members SET clerk_user_id = ? WHERE id = ?').run(clerkUserId, 'admin')
    const before = state()
    expect((await team.DELETE(req('DELETE'), context('super_admin'))).status).toBe(409)
    expect((await assignRole(req('POST', { teamMemberId: 'super_admin', roleId: 'role-viewer' }))).status).toBe(409)
    expect(state()).toEqual(before)
  })
  it('permits removal of an unlinked owner only by super_admin while a linked owner remains', async () => {
    fixture.insert(schema.teamMemberRoles, { id: 'unlinked-owner', team_member_id: 'viewer', role_id: 'role-super_admin', ended_at: null })
    fixture.sqlite.prepare('UPDATE team_members SET clerk_user_id = NULL WHERE id = ?').run('viewer')
    as('admin')
    expect((await team.DELETE(req('DELETE'), context('viewer'))).status).toBe(403)
    as('super_admin')
    expect((await team.DELETE(req('DELETE'), context('viewer'))).status).toBe(200)
    expect(fixture.rows(schema.teamMembers).find(row => row.id === 'super_admin')).toMatchObject({ clerk_user_id: 'user_super_admin' })
  })
  it.each(['assign', 'copy'] as const)('rolls back %s role replacement when its insert fails', async action => {
    as('super_admin')
    if (action === 'copy') {
      fixture.sqlite.prepare('UPDATE team_member_roles SET ended_at = ? WHERE team_member_id = ?').run('2026-10-14T00:00:00Z', 'viewer')
      fixture.insert(schema.teamMemberRoles, { id: 'unlinked-source', team_member_id: 'viewer', role_id: 'role-super_admin', ended_at: null })
      fixture.sqlite.prepare('UPDATE team_members SET clerk_user_id = NULL WHERE id = ?').run('viewer')
    }
    const beforeRoles = fixture.rows(schema.teamMemberRoles)
    const beforeMembers = fixture.rows(schema.teamMembers)
    const beforeAudit = fixture.rows(schema.auditLog)
    fixture.sqlite.exec("CREATE TRIGGER reject_role_insert BEFORE INSERT ON team_member_roles BEGIN SELECT RAISE(ABORT, 'injected role insert failure'); END")
    const pending = action === 'assign'
      ? assignRole(req('POST', { teamMemberId: 'super_admin', roleId: 'role-super_admin' }))
      : copyAccess(req('POST', { subjectType: 'team_member', sourceId: 'viewer', targetId: 'super_admin' }))
    await expect(pending).rejects.toThrow('injected role insert failure')
    expect(fixture.rows(schema.teamMemberRoles)).toEqual(beforeRoles)
    expect(fixture.rows(schema.teamMembers)).toEqual(beforeMembers)
    expect(fixture.rows(schema.auditLog)).toEqual(beforeAudit)
    expect(fixture.rows(schema.settings).some(row => row.key === 'permissions.ownerMutationLock')).toBe(false)
  })
  it.each(['assign', 'copy', 'relink'] as const)('rechecks revoked caller access after the %s mutation lock', async action => {
    as('super_admin')
    const originalClaim = ownerSafety.acquireOwnerMutationLock
    let resume: () => void = () => {}
    let claimed: () => void = () => {}
    const paused = new Promise<void>(resolve => { resume = resolve })
    const entered = new Promise<void>(resolve => { claimed = resolve })
    const claimSpy = vi.spyOn(ownerSafety, 'acquireOwnerMutationLock').mockImplementationOnce(async database => {
      claimed()
      await paused
      return originalClaim(database)
    })
    const pending = action === 'assign'
      ? assignRole(req('POST', { teamMemberId: 'viewer', roleId: 'role-super_admin' }))
      : action === 'copy'
        ? copyAccess(req('POST', { subjectType: 'team_member', sourceId: 'admin', targetId: 'viewer' }))
        : team.PUT(req('PUT', { clerkUserId: 'replacement' }), context('viewer'))
    await entered
    fixture.sqlite.prepare('UPDATE team_member_roles SET role_id = ? WHERE team_member_id = ? AND ended_at IS NULL').run('role-viewer', 'super_admin')
    const before = state()
    resume()
    expect((await pending).status).toBe(403)
    expect(state()).toEqual(before)
    claimSpy.mockRestore()
  })
  it('serializes simultaneous owner demotions so one owner remains', async () => {
    as('super_admin')
    fixture.insert(schema.teamMemberRoles, { id: 'second-owner', team_member_id: 'admin', role_id: 'role-super_admin', ended_at: null })
    const responses = await Promise.all([
      assignRole(req('POST', { teamMemberId: 'super_admin', roleId: 'role-viewer' })),
      assignRole(req('POST', { teamMemberId: 'admin', roleId: 'role-viewer' })),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(fixture.rows(schema.teamMemberRoles).filter(row => row.role_id === 'role-super_admin' && row.ended_at === null)).toHaveLength(1)
  })
  it('refuses every owner mutation while another worker owns the lock', async () => {
    as('super_admin')
    const mutation = await acquireOwnerMutationLock(fixture.database)
    expect(mutation.denied).toBeNull()
    const before = state()
    const responses = [
      await assignRole(req('POST', { teamMemberId: 'viewer', roleId: 'role-admin' })),
      await copyAccess(req('POST', { subjectType: 'team_member', sourceId: 'viewer', targetId: 'admin' })),
      await team.PUT(req('PUT', { clerkUserId: null }), context('viewer')),
      await team.DELETE(req('DELETE'), context('viewer')),
    ]
    expect(responses.map(response => response.status)).toEqual([409, 409, 409, 409])
    expect(state()).toEqual(before)
    await mutation.release()
    expect((await team.PUT(req('PUT', { clerkUserId: null }), context('viewer'))).status).toBe(200)
  })
  it('reclaims an expired lock after an aborted worker', async () => {
    fixture.insert(schema.settings, {
      key: 'permissions.ownerMutationLock', value: JSON.stringify({ token: 'stale', expiresAt: '2000-01-01T00:00:00Z' }),
    })
    as('super_admin')
    expect((await team.PUT(req('PUT', { clerkUserId: 'replacement' }), context('viewer'))).status).toBe(200)
    expect(fixture.rows(schema.settings).some(row => row.key === 'permissions.ownerMutationLock')).toBe(false)
  })
  it.each(['admin', 'api-service'] as const)('refuses super_admin grants by %s', async role => {
    as(role)
    const before = state()
    expect((await assignRole(req('POST', { teamMemberId: 'viewer', roleId: 'role-super_admin' }))).status).toBe(403)
    expect(state()).toEqual(before)
  })
  it('allows a super_admin to grant super_admin', async () => {
    as('super_admin')
    expect((await assignRole(req('POST', { teamMemberId: 'viewer', roleId: 'role-super_admin' }))).status).toBe(200)
    expect(fixture.rows(schema.teamMemberRoles).some(row => row.team_member_id === 'viewer' && row.role_id === 'role-super_admin' && row.ended_at === null)).toBe(true)
  })
  it.each(['admin', 'api-service'] as const)('refuses admin and super_admin copies by %s before overrides change', async role => {
    as(role)
    for (const sourceId of ['admin', 'super_admin']) {
      const before = state()
      expect((await copyAccess(req('POST', { subjectType: 'team_member', sourceId, targetId: 'viewer' }))).status).toBe(403)
      expect(state()).toEqual(before)
    }
  })
  it.each(['admin', 'super_admin'] as const)('lets super_admin copy %s access', async sourceId => {
    as('super_admin')
    expect((await copyAccess(req('POST', { subjectType: 'team_member', sourceId, targetId: 'viewer' }))).status).toBe(200)
  })
  it.each(['admin', 'api-service'] as const)('refuses login and legacy role changes by %s', async role => {
    as(role)
    for (const body of [{ clerkUserId: 'replacement' }, { role: 'admin' }]) {
      const before = state()
      expect((await team.PUT(req('PUT', body), context('viewer'))).status).toBe(403)
      expect(state()).toEqual(before)
    }
  })
  it('lets super_admin relink a login and change legacy role', async () => {
    as('super_admin')
    expect((await team.PUT(req('PUT', { clerkUserId: 'replacement', role: 'admin' }), context('viewer'))).status).toBe(200)
    expect(fixture.rows(schema.teamMembers).find(row => row.id === 'viewer')).toMatchObject({ clerk_user_id: 'replacement', role: 'admin' })
  })
  it.each(['admin', 'api-service'] as const)('refuses owner deletion and demotion by %s', async role => {
    as(role)
    const before = state()
    expect((await team.DELETE(req('DELETE'), context('super_admin'))).status).toBe(403)
    expect((await assignRole(req('POST', { teamMemberId: 'super_admin', roleId: 'role-admin' }))).status).toBe(403)
    expect(state()).toEqual(before)
  })
  it('refuses deleting, clearing, demoting, copying over or unlinking the last super_admin', async () => {
    as('super_admin')
    const before = state()
    const calls = [
      () => team.DELETE(req('DELETE'), context('super_admin')),
      () => assignRole(req('POST', { teamMemberId: 'super_admin', roleId: null })),
      () => assignRole(req('POST', { teamMemberId: 'super_admin', roleId: 'role-admin' })),
      () => copyAccess(req('POST', { subjectType: 'team_member', sourceId: 'viewer', targetId: 'super_admin' })),
      () => team.PUT(req('PUT', { clerkUserId: null }), context('super_admin')),
      () => team.PUT(req('PUT', { role: 'member' }), context('super_admin')),
    ]
    for (const call of calls) {
      expect((await call()).status).toBe(409)
      expect(state()).toEqual(before)
    }
  })
  it.each(['delete', 'demote'] as const)('allows super_admin to %s another owner when one remains', async action => {
    as('super_admin')
    fixture.insert(schema.teamMemberRoles, { id: 'second-owner', team_member_id: 'admin', role_id: 'role-super_admin', ended_at: null })
    const response = action === 'delete'
      ? await team.DELETE(req('DELETE'), context('admin'))
      : await assignRole(req('POST', { teamMemberId: 'admin', roleId: 'role-viewer' }))
    expect(response.status).toBe(200)
    expect(fixture.rows(schema.teamMembers).some(row => row.id === 'super_admin')).toBe(true)
  })
})
