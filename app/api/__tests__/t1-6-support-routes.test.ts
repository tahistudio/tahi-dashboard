import { is } from 'drizzle-orm'
import { SQLiteTable, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { requireAdmin } from '@/lib/require-admin'
import { requireReplyDraftAccess } from '@/lib/reply-draft-access'
import { requireCalculationAccess } from '@/lib/calculation-access'
import * as invoiceIndex from '@/app/api/admin/invoices/route'
import * as triage from '@/app/api/admin/leads/triage-pipeline/route'
import * as dedupeMr from '@/app/api/admin/invoices/dedupe-manyrequests-twins/route'
import * as dedupeStripe from '@/app/api/admin/invoices/dedupe-stripe-charges/route'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { FEATURE_TREE } from '@/lib/feature-tree'
import { permissionSqlite } from './helpers/permission-sqlite'
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({ getRequestAuth: vi.fn(), isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi' }))
vi.mock('@/lib/ai-briefing', () => ({ generateBriefing: vi.fn() }))
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import * as route0 from '@/app/api/admin/ai/briefing/route'
import * as route1 from '@/app/api/admin/ai/predict-fields/route'
import * as route2 from '@/app/api/admin/ai/task-wizard/route'
import * as route3 from '@/app/api/admin/ai-reply-drafts/[id]/route'
import * as route4 from '@/app/api/admin/ai-reply-drafts/[id]/send/route'
import * as route5 from '@/app/api/admin/announcements/route'
import * as route6 from '@/app/api/admin/announcements/[id]/route'
import * as route7 from '@/app/api/admin/announcements/[id]/send/route'
import * as route8 from '@/app/api/admin/automations/log/route'
import * as route9 from '@/app/api/admin/automations/route'
import * as route10 from '@/app/api/admin/automations/[id]/route'
import * as route11 from '@/app/api/admin/calculator/draft/route'
import * as route12 from '@/app/api/admin/calculator/route'
import * as route13 from '@/app/api/admin/case-studies/draft/route'
import * as route14 from '@/app/api/admin/deals/[id]/calls/route'
import * as route15 from '@/app/api/admin/deals/[id]/contacts/route'
import * as route16 from '@/app/api/admin/deals/[id]/route'
import * as route17 from '@/app/api/admin/derive-billing/route'
import * as route18 from '@/app/api/admin/discovery-calls/upcoming/route'
import * as route19 from '@/app/api/admin/discovery-calls/[id]/extract/route'
import * as route20 from '@/app/api/admin/discovery-calls/[id]/route'
import * as route21 from '@/app/api/admin/feedback/route'
import * as route22 from '@/app/api/admin/feedback/[id]/route'
import * as route23 from '@/app/api/admin/feedback/[id]/screenshot/route'
import * as route24 from '@/app/api/admin/invoices/backfill-numbers/route'
import * as route25 from '@/app/api/admin/invoices/xero-sync/route'
import * as route26 from '@/app/api/admin/leads/[id]/calls/route'
import * as route27 from '@/app/api/admin/leads/[id]/promote/route'
import * as route28 from '@/app/api/admin/nudge-templates/route'
import * as route29 from '@/app/api/admin/onboarding-invites/route'
import * as route30 from '@/app/api/admin/pipeline/capacity/route'
import * as route31 from '@/app/api/admin/pipeline/seed/route'
import * as route32 from '@/app/api/admin/pipeline/stages/route'
import * as route33 from '@/app/api/admin/pipeline/stages/[id]/route'
import * as route34 from '@/app/api/admin/reviews/outreach/route'
import * as route35 from '@/app/api/admin/reviews/route'
import * as route36 from '@/app/api/admin/services/coupons/route'
import * as route37 from '@/app/api/admin/services/route'
import * as route38 from '@/app/api/admin/services/[id]/route'

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
const CASES: Array<{ name: string; method: string; handler: Handler }> = [
  { name: 'POST invoices', method: 'POST', handler: invoiceIndex.POST },
  { name: 'POST triage', method: 'POST', handler: triage.POST },
  { name: 'POST dedupe MR', method: 'POST', handler: dedupeMr.POST },
  { name: 'POST dedupe Stripe', method: 'POST', handler: dedupeStripe.POST },
  { name: 'GET /api/admin/ai/briefing', method: 'GET', handler: route0.GET as Handler },
  { name: 'POST /api/admin/ai/briefing', method: 'POST', handler: route0.POST as Handler },
  { name: 'POST /api/admin/ai/predict-fields', method: 'POST', handler: route1.POST as Handler },
  { name: 'POST /api/admin/ai/task-wizard', method: 'POST', handler: route2.POST as Handler },
  { name: 'PATCH /api/admin/ai-reply-drafts/[id]', method: 'PATCH', handler: route3.PATCH as Handler },
  { name: 'DELETE /api/admin/ai-reply-drafts/[id]', method: 'DELETE', handler: route3.DELETE as Handler },
  { name: 'POST /api/admin/ai-reply-drafts/[id]/send', method: 'POST', handler: route4.POST as Handler },
  { name: 'GET /api/admin/announcements', method: 'GET', handler: route5.GET as Handler },
  { name: 'POST /api/admin/announcements', method: 'POST', handler: route5.POST as Handler },
  { name: 'PATCH /api/admin/announcements/[id]', method: 'PATCH', handler: route6.PATCH as Handler },
  { name: 'DELETE /api/admin/announcements/[id]', method: 'DELETE', handler: route6.DELETE as Handler },
  { name: 'POST /api/admin/announcements/[id]/send', method: 'POST', handler: route7.POST as Handler },
  { name: 'GET /api/admin/automations/log', method: 'GET', handler: route8.GET as Handler },
  { name: 'GET /api/admin/automations', method: 'GET', handler: route9.GET as Handler },
  { name: 'POST /api/admin/automations', method: 'POST', handler: route9.POST as Handler },
  { name: 'PATCH /api/admin/automations/[id]', method: 'PATCH', handler: route10.PATCH as Handler },
  { name: 'DELETE /api/admin/automations/[id]', method: 'DELETE', handler: route10.DELETE as Handler },
  { name: 'POST /api/admin/calculator/draft', method: 'POST', handler: route11.POST as Handler },
  { name: 'GET /api/admin/calculator', method: 'GET', handler: route12.GET as Handler },
  { name: 'POST /api/admin/calculator', method: 'POST', handler: route12.POST as Handler },
  { name: 'PATCH /api/admin/calculator', method: 'PATCH', handler: route12.PATCH as Handler },
  { name: 'DELETE /api/admin/calculator', method: 'DELETE', handler: route12.DELETE as Handler },
  { name: 'POST /api/admin/case-studies/draft', method: 'POST', handler: route13.POST as Handler },
  { name: 'GET /api/admin/deals/[id]/calls', method: 'GET', handler: route14.GET as Handler },
  { name: 'POST /api/admin/deals/[id]/calls', method: 'POST', handler: route14.POST as Handler },
  { name: 'GET /api/admin/deals/[id]/contacts', method: 'GET', handler: route15.GET as Handler },
  { name: 'POST /api/admin/deals/[id]/contacts', method: 'POST', handler: route15.POST as Handler },
  { name: 'DELETE /api/admin/deals/[id]/contacts', method: 'DELETE', handler: route15.DELETE as Handler },
  { name: 'GET /api/admin/deals/[id]', method: 'GET', handler: route16.GET as Handler },
  { name: 'PATCH /api/admin/deals/[id]', method: 'PATCH', handler: route16.PATCH as Handler },
  { name: 'DELETE /api/admin/deals/[id]', method: 'DELETE', handler: route16.DELETE as Handler },
  { name: 'POST /api/admin/derive-billing', method: 'POST', handler: route17.POST as Handler },
  { name: 'GET /api/admin/discovery-calls/upcoming', method: 'GET', handler: route18.GET as Handler },
  { name: 'POST /api/admin/discovery-calls/[id]/extract', method: 'POST', handler: route19.POST as Handler },
  { name: 'PATCH /api/admin/discovery-calls/[id]', method: 'PATCH', handler: route20.PATCH as Handler },
  { name: 'DELETE /api/admin/discovery-calls/[id]', method: 'DELETE', handler: route20.DELETE as Handler },
  { name: 'GET /api/admin/feedback', method: 'GET', handler: route21.GET as Handler },
  { name: 'DELETE /api/admin/feedback/[id]', method: 'DELETE', handler: route22.DELETE as Handler },
  { name: 'GET /api/admin/feedback/[id]/screenshot', method: 'GET', handler: route23.GET as Handler },
  { name: 'POST /api/admin/invoices/backfill-numbers', method: 'POST', handler: route24.POST as Handler },
  { name: 'POST /api/admin/invoices/xero-sync', method: 'POST', handler: route25.POST as Handler },
  { name: 'GET /api/admin/leads/[id]/calls', method: 'GET', handler: route26.GET as Handler },
  { name: 'POST /api/admin/leads/[id]/calls', method: 'POST', handler: route26.POST as Handler },
  { name: 'POST /api/admin/leads/[id]/promote', method: 'POST', handler: route27.POST as Handler },
  { name: 'GET /api/admin/nudge-templates', method: 'GET', handler: route28.GET as Handler },
  { name: 'POST /api/admin/nudge-templates', method: 'POST', handler: route28.POST as Handler },
  { name: 'PATCH /api/admin/nudge-templates', method: 'PATCH', handler: route28.PATCH as Handler },
  { name: 'GET /api/admin/onboarding-invites', method: 'GET', handler: route29.GET as Handler },
  { name: 'POST /api/admin/onboarding-invites', method: 'POST', handler: route29.POST as Handler },
  { name: 'GET /api/admin/pipeline/capacity', method: 'GET', handler: route30.GET as Handler },
  { name: 'POST /api/admin/pipeline/seed', method: 'POST', handler: route31.POST as Handler },
  { name: 'GET /api/admin/pipeline/stages', method: 'GET', handler: route32.GET as Handler },
  { name: 'POST /api/admin/pipeline/stages', method: 'POST', handler: route32.POST as Handler },
  { name: 'PUT /api/admin/pipeline/stages', method: 'PUT', handler: route32.PUT as Handler },
  { name: 'DELETE /api/admin/pipeline/stages/[id]', method: 'DELETE', handler: route33.DELETE as Handler },
  { name: 'POST /api/admin/reviews/outreach', method: 'POST', handler: route34.POST as Handler },
  { name: 'GET /api/admin/reviews', method: 'GET', handler: route35.GET as Handler },
  { name: 'POST /api/admin/reviews', method: 'POST', handler: route35.POST as Handler },
  { name: 'GET /api/admin/services/coupons', method: 'GET', handler: route36.GET as Handler },
  { name: 'POST /api/admin/services/coupons', method: 'POST', handler: route36.POST as Handler },
  { name: 'DELETE /api/admin/services/coupons', method: 'DELETE', handler: route36.DELETE as Handler },
  { name: 'GET /api/admin/services', method: 'GET', handler: route37.GET as Handler },
  { name: 'POST /api/admin/services', method: 'POST', handler: route37.POST as Handler },
  { name: 'PATCH /api/admin/services/[id]', method: 'PATCH', handler: route38.PATCH as Handler },
]
let fixture: ReturnType<typeof permissionSqlite>
const schemaValues: unknown[] = Object.values(schema)
const TABLES = schemaValues.filter((table): table is AnySQLiteTable => is(table, SQLiteTable))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  fixture = permissionSqlite(TABLES)
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi', sessionId: 'test' })
  fixture.insert(schema.roles, { id: 'member-role', name: 'project_manager' })
  fixture.insert(schema.roles, { id: 'admin-role', name: 'admin' })
  fixture.insert(schema.roles, { id: 'super-role', name: 'super_admin' })
  for (const [id, user, role] of [['member','user_member','member-role'], ['admin','user_admin','admin-role'], ['super','user_super','super-role']]) {
    fixture.insert(schema.teamMembers, { id, clerk_user_id: user, name: id, role: role === 'member-role' ? 'member' : 'admin' })
    fixture.insert(schema.teamMemberRoles, { id, team_member_id: id, role_id: role, ended_at: null })
  }
  fixture.insert(schema.teamMemberAccess, { id: 'scope', team_member_id: 'member', role: 'task_handler', scope_type: 'specific_clients' })
  fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'scope', org_id: 'org-a' })
  for (const suffix of ['a', 'b']) {
    fixture.insert(schema.organisations, { id: 'org-' + suffix, name: suffix, status: 'active' })
    fixture.insert(schema.invoices, { id: 'invoice-' + suffix, org_id: 'org-' + suffix })
    fixture.insert(schema.contacts, { id: 'contact-' + suffix, org_id: 'org-' + suffix, name: suffix })
    fixture.insert(schema.deals, { id: 'deal-' + suffix, org_id: 'org-' + suffix, title: suffix })
    fixture.insert(schema.caseStudySubmissions, { id: 'submission-' + suffix, org_id: 'org-' + suffix })
    fixture.insert(schema.requests, { id: 'request-' + suffix, org_id: 'org-' + suffix, title: suffix })
    fixture.insert(schema.subscriptions, { id: 'sub-' + suffix, org_id: 'org-' + suffix })
    fixture.insert(schema.projectCalculations, { id: 'calc-' + suffix, org_id: 'org-' + suffix, name: suffix })
  }
  fixture.insert(schema.leads, { id: 'target', name: 'Lead', status: 'new' })
  fixture.insert(schema.pipelineStages, { id: 'stage', slug: 'lead', name: 'Lead', position: 0 })
  fixture.sqlite.exec("UPDATE deals SET stage_id = 'stage'")
  fixture.insert(schema.aiReplyDrafts, { id: 'target', invoice_id: 'invoice-b' })
  fixture.insert(schema.discoveryCalls, { id: 'target', org_id: 'org-b', title: 'Foreign' })
})
afterEach(() => { fixture.close(); vi.unstubAllEnvs() })
function req(method: string, body: object = {}, query = '') { return new NextRequest('http://localhost/api/admin/test' + query, { method, ...(method === 'GET' ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) }) }
function features(effect: 'allow' | 'deny') {
  for (const node of FEATURE_TREE.filter(node => node.appliesTo.includes('team'))) fixture.insert(schema.featureVisibility, { id: node.key, subject_type: 'team_member', subject_id: 'member', feature_key: node.key, effect })
}
describe.each(CASES)('$name', scenario => {
  it('refuses a scoped seat whose feature is denied before mutation or returning data', async () => {
    features('deny')
    const before = TABLES.map(table => fixture.rows(table))
    const response = await scenario.handler(req(scenario.method, { subject: 'request', orgId: 'org-b', submissionId: 'submission-b', invoiceId: 'invoice-b', contactId: 'contact-b' }), { params: Promise.resolve({ id: 'target' }) })
    expect(response.status).toBe(403)
    expect(TABLES.map(table => fixture.rows(table))).toEqual(before)
    expect(fixture.errors).toEqual([])
  })
})

const FOREIGN_WRITES: Array<{ name: string; method: string; handler: Handler; body?: object; id?: string; query?: string }> = [
  { name: 'review', method: 'POST', handler: route35.POST, body: { orgId: 'org-b', outreachStatus: 'asked' } },
  { name: 'case study', method: 'POST', handler: route13.POST, body: { submissionId: 'submission-b' } },
  { name: 'call extract', method: 'POST', handler: route19.POST },
  { name: 'call patch', method: 'PATCH', handler: route20.PATCH, body: { title: 'Changed' } },
  { name: 'call delete', method: 'DELETE', handler: route20.DELETE },
  { name: 'draft patch', method: 'PATCH', handler: route3.PATCH, body: { finalSubject: 'Changed' } },
  { name: 'draft delete', method: 'DELETE', handler: route3.DELETE },
  { name: 'draft send', method: 'POST', handler: route4.POST },
  { name: 'Xero org batch', method: 'POST', handler: route25.POST, body: { orgId: 'org-b', dryRun: true } },
  { name: 'Xero mixed batch', method: 'POST', handler: route25.POST, body: { invoiceIds: ['invoice-a', 'invoice-b'], dryRun: true } },
  { name: 'deal contact add', method: 'POST', handler: route15.POST, id: 'deal-a', body: { contactId: 'contact-b' } },
  { name: 'deal contact remove', method: 'DELETE', handler: route15.DELETE, id: 'deal-a', body: { contactId: 'contact-b' } },
  { name: 'lead existing client', method: 'POST', handler: route27.POST, body: { orgId: 'org-b' } },
  { name: 'lead create client', method: 'POST', handler: route27.POST, body: { createOrg: true } },
  { name: 'lead foreign source call', method: 'POST', handler: route27.POST, body: { orgId: 'org-a', sourceCallId: 'target' } },
  { name: 'team invite access grant', method: 'POST', handler: route29.POST, body: { flow: 'team' } },
  { name: 'invoice foreign subscription', method: 'POST', handler: invoiceIndex.POST, body: { orgId: 'org-a', subscriptionId: 'sub-b', lineItems: [{ description: 'Test', quantity: 1, unitAmount: 1 }] } },
  { name: 'calculation create foreign org', method: 'POST', handler: route12.POST, body: { name: 'Calc', orgId: 'org-b', inputs: {} } },
  { name: 'calculation create foreign deal', method: 'POST', handler: route12.POST, body: { name: 'Calc', orgId: 'org-a', dealId: 'deal-b', inputs: {} } },
  { name: 'calculation patch', method: 'PATCH', handler: route12.PATCH, body: { id: 'calc-b', name: 'Changed' } },
  { name: 'calculation delete mixed', method: 'DELETE', handler: route12.DELETE, query: '?ids=calc-a,calc-b' },
  { name: 'calculation draft', method: 'POST', handler: route11.POST, body: { calculationId: 'calc-b', target: 'proposal' } },
  { name: 'task wizard client', method: 'POST', handler: route2.POST, body: { messages: [{ role: 'user', content: 'Design a page' }], context: { orgId: 'org-b' } } },
  { name: 'prediction client', method: 'POST', handler: route1.POST, body: { subject: 'request', orgId: 'org-b', title: 'Design a landing page for the product', empty: ['dueDate'] } },
]

describe.each(FOREIGN_WRITES)('$name with feature access', scenario => {
  it('returns 403 for a foreign target and changes no row, even with a privileged recorded actor', async () => {
    features('allow')
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi', sessionId: 'test', mcpActor: { teamMemberId: 'super', clerkUserId: 'user_super', profile: 'full' } })
    const before = TABLES.map(table => fixture.rows(table))
    const response = await scenario.handler(req(scenario.method, scenario.body, scenario.query), { params: Promise.resolve({ id: scenario.id ?? 'target' }) })
    expect(response.status).toBe(403)
    expect(TABLES.map(table => fixture.rows(table))).toEqual(before)
    expect(fixture.errors).toEqual([])
  })
})

type Payload = { reviews: Array<{ orgId: string }>; calculations: Array<{ id: string }>; items: Array<{ contactId: string }>; stages: Array<{ totalDeals: number }>; calls: Array<{ id: string }> }
function payload(response: Response): Promise<Payload> { return response.json() as Promise<Payload> }

describe('scoped lists and privileged invariants', () => {
  it('filters reviews, calculations, linked contacts and stage statistics through real SQL', async () => {
    features('allow')
    fixture.insert(schema.dealContacts, { id: 'link-a', deal_id: 'deal-a', contact_id: 'contact-a' })
    fixture.insert(schema.dealContacts, { id: 'link-b', deal_id: 'deal-a', contact_id: 'contact-b' })
    expect((await payload(await route35.GET(req('GET')))).reviews.map((row: { orgId: string }) => row.orgId)).toEqual(['org-a'])
    expect((await payload(await route12.GET(req('GET')))).calculations.map((row: { id: string }) => row.id)).toEqual(['calc-a'])
    expect((await payload(await route15.GET(req('GET'), { params: Promise.resolve({ id: 'deal-a' }) }))).items.map((row: { contactId: string }) => row.contactId)).toEqual(['contact-a'])
    expect((await payload(await route32.GET(req('GET')))).stages[0].totalDeals).toBe(1)
    expect(fixture.errors).toEqual([])
  })

  it('filters every polymorphic call parent before LIMIT and before nested enrichment', async () => {
    features('allow')
    for (let index = 0; index < 12; index++) fixture.insert(schema.discoveryCalls, {
      id: `foreign-${index}`, org_id: 'org-a', request_id: 'request-b', lead_id: 'target', deal_id: 'deal-a',
      scheduled_at: new Date(Date.now() + 60_000 + index).toISOString(), status: 'scheduled', title: 'Foreign linked title',
    })
    fixture.insert(schema.discoveryCalls, { id: 'allowed', org_id: 'org-a', lead_id: 'target', deal_id: 'deal-a', scheduled_at: new Date(Date.now() + 120_000).toISOString(), status: 'scheduled', title: 'Allowed' })
    const response = await route18.GET(req('GET', {}, '?limit=1'))
    expect((await payload(response)).calls.map((row: { id: string }) => row.id)).toEqual(['allowed'])
    for (const handler of [route14.GET, route26.GET]) {
      const id = handler === route14.GET ? 'deal-a' : 'target'
      expect((await payload(await handler(req('GET'), { params: Promise.resolve({ id }) }))).calls.map((row: { id: string }) => row.id)).toEqual(['allowed'])
    }
    expect(fixture.errors).toEqual([])
  })

  it('scopes prediction grounding and benchmark fallback before each LIMIT', async () => {
    features('allow')
    const response = await route1.POST(req('POST', { subject: 'request', orgId: 'org-a', title: 'Design a product landing page', empty: ['dueDate'] }))
    expect(response.status).toBe(200)
    const grounding = fixture.queries.filter(query => query.includes('from "requests"') || query.includes('join "requests"'))
    expect(grounding.length).toBeGreaterThan(1)
    for (const query of grounding) {
      expect(query).toContain("'org-a'")
      expect(query).not.toContain("'org-b'")
      expect(query.indexOf("'org-a'")).toBeLessThan(query.indexOf('limit'))
    }
    expect(fixture.errors).toEqual([])
  })

  it.each(['user_admin', 'user_super', 'api-service'])('keeps %s unrestricted with the authenticated identity', async userId => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId: 'org_tahi', sessionId: 'test', mcpActor: { teamMemberId: 'member', clerkUserId: 'user_member', profile: 'designer' } })
    const auth = { userId, orgId: 'org_tahi' }
    expect(await requireAdmin(auth)).toBeNull()
    expect(await requireReplyDraftAccess(fixture.database, auth, 'target')).toBeNull()
    expect(await requireCalculationAccess(fixture.database, auth, 'calc-b')).toBeNull()
    expect((await payload(await route35.GET(req('GET')))).reviews).toHaveLength(2)
    expect((await payload(await route12.GET(req('GET')))).calculations).toHaveLength(2)
    expect(fixture.errors).toEqual([])
  })
})
