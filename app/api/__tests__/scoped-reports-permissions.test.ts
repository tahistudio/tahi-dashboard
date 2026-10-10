/** Real aggregates must apply tenant scope before counting, summing or averaging. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  resolvePermissions: vi.fn(),
}))
vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: vi.fn() }))

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth } from '@/lib/server-auth'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { GET as overview } from '@/app/api/admin/reports/overview/route'
import { GET as closeRates } from '@/app/api/admin/reports/close-rates/route'
import { GET as forecast } from '@/app/api/admin/reports/pipeline-forecast/route'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
// Alias IDs also exercise imported deals whose IDs are not UUIDs.
const A_OPEN = 'deal-a-open'
const B_OPEN = 'deal-b-open'
const CREATED = '2026-10-01T00:00:00.000Z'
let fixture: ReturnType<typeof permissionSqlite>
let access: ResolvedAccess

interface OverviewReport {
  totalClients: number
  totalRequests: number
  openRequests: number
  avgDeliveryDays: number
  totalBillableHours: number
  outstandingInvoiceAmount: number
  requestsByStatus: Record<string, number>
  monthlyTrend: Record<string, number>
}

interface ForecastReport {
  totalDeals: number
  unweightedUpfrontNzd: number
  unweightedMonthlyNzd: number
  weightedUpfrontNzd: number
  weightedMonthlyNzd: number
  byStage: Array<{ stageId: string; dealCount: number; upfrontNzd: number; monthlyNzd: number }>
}

interface CloseRatesReport {
  stageConversions: Array<{ entered: number; converted: number; conversionRate: number }>
  monthlyWinLoss: Array<{ month: string; won: number; lost: number; wonValue: number; lostValue: number }>
  revenueByStage: Array<{ stageId: string; dealCount: number; totalValue: number }>
  stageVelocity: Array<{ stageId: string; avgDays: number; dealCount: number }>
}

function memberAccess(): ResolvedAccess {
  return {
    userId: 'user_member', orgId: 'org_tahi', level: 'team_member', audience: 'team',
    isSuperAdmin: false, isAdmin: false, canManagePermissions: false,
    viewableResources: new Set(['reports', 'invoices', 'sales_analytics']), overrides: new Map(),
  }
}

function seed() {
  for (const id of [ORG_A, ORG_B]) fixture.insert(schema.organisations, { id, status: 'active' })
  fixture.insert(schema.requests, { id: 'request-a-open', org_id: ORG_A, status: 'submitted', created_at: CREATED })
  fixture.insert(schema.requests, {
    id: 'request-a-delivered', org_id: ORG_A, status: 'delivered', created_at: CREATED,
    delivered_at: '2026-10-03T00:00:00.000Z',
  })
  fixture.insert(schema.requests, { id: 'request-b-open', org_id: ORG_B, status: 'in_progress', created_at: CREATED })
  fixture.insert(schema.requests, { id: 'request-b-archived', org_id: ORG_B, status: 'archived', created_at: CREATED })
  fixture.insert(schema.requests, {
    id: 'request-b-delivered', org_id: ORG_B, status: 'delivered',
    created_at: '2026-07-01T00:00:00.000Z', delivered_at: '2026-09-29T00:00:00.000Z',
  })
  fixture.insert(schema.timeEntries, { id: 'hours-a', org_id: ORG_A, hours: 2.5, billable: 1 })
  fixture.insert(schema.timeEntries, { id: 'hours-a-free', org_id: ORG_A, hours: 99, billable: 0 })
  fixture.insert(schema.timeEntries, { id: 'hours-b', org_id: ORG_B, hours: 80, billable: 1 })
  for (const [id, org, status, amount] of [
    ['invoice-a-sent', ORG_A, 'sent', 100], ['invoice-a-draft', ORG_A, 'draft', 10000],
    ['invoice-a-paid', ORG_A, 'paid', 9000], ['invoice-b-sent', ORG_B, 'sent', 900],
  ] as const) fixture.insert(schema.invoices, { id, org_id: org, status, total_usd: amount })
  for (const [id, name, position, probability, won, lost] of [
    ['open', 'Discovery', 0, 50, 0, 0], ['won', 'Won', 1, 100, 1, 0], ['lost', 'Lost', 2, 0, 0, 1],
  ] as const) fixture.insert(schema.pipelineStages, {
    id, name, slug: id, position, probability, is_closed_won: won, is_closed_lost: lost,
  })
  for (const [id, org, stage, value, monthly] of [
    [A_OPEN, ORG_A, 'open', 1000, 100], [B_OPEN, ORG_B, 'open', 9000, 900],
    ['unlinked-open', null, 'open', 500, 50],
    ['a-won', ORG_A, 'won', 200, 0], ['b-won', ORG_B, 'won', 900, 0],
    ['a-lost', ORG_A, 'lost', 300, 0], ['b-lost', ORG_B, 'lost', 800, 0],
  ] as const) fixture.insert(schema.deals, {
    id, org_id: org, stage_id: stage, value_nzd: value, upfront_value_nzd: value,
    monthly_value_nzd: monthly, created_at: CREATED,
    closed_at: stage === 'open' ? null : '2026-10-04T00:00:00.000Z',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-11T00:00:00.000Z'))
  fixture = permissionSqlite([
    schema.organisations, schema.requests, schema.timeEntries, schema.invoices,
    schema.pipelineStages, schema.deals, schema.activities,
  ], [
    // Migration 0017 in app/api/admin/db/migrate/route.ts adds this raw-SQL
    // column, intentionally omitted from Drizzle (see lib/deal-activity.ts).
    'ALTER TABLE activities ADD COLUMN metadata text',
  ])
  access = memberAccess()
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi', sessionId: 'session-1' })
  vi.mocked(resolvePermissions).mockImplementation(async () => access)
  vi.mocked(resolveAccessScoping).mockResolvedValue([ORG_A])
  seed()
})

afterEach(() => {
  fixture.close()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function read<T>(handler: (request: NextRequest) => Promise<Response>, path: string): Promise<T> {
  const response = await handler(new NextRequest(`http://localhost/api/admin/reports/${path}`))
  expect(response.status).toBe(200)
  expect(fixture.errors).toEqual([])
  return await response.json() as T
}

describe('reports overview is scoped across every aggregate', () => {
  it.each([
    ['totalClients', 1], ['totalRequests', 2], ['openRequests', 1],
    ['totalBillableHours', 2.5], ['outstandingInvoiceAmount', 100], ['avgDeliveryDays', 2],
  ] as const)('returns only permitted-client %s', async (key, expected) => {
    const body = await read<OverviewReport>(overview, 'overview')
    expect(body[key]).toBe(expected)
  })

  it('scopes status groups and the monthly trend, with no other client activity', async () => {
    const body = await read<OverviewReport>(overview, 'overview')
    expect(body.requestsByStatus).toEqual({ submitted: 1, delivered: 1 })
    expect(body.monthlyTrend['2026-10']).toBe(2)
    expect(Object.values(body.monthlyTrend).reduce((sum: number, value) => sum + Number(value), 0)).toBe(2)
  })

  it.each([{ ids: [] }, { ids: ['org-not-present'] }])('returns zero aggregates for inaccessible scope $ids', async ({ ids }) => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(ids)
    const body = await read<OverviewReport>(overview, 'overview')
    expect(body).toMatchObject({
      totalClients: 0, totalRequests: 0, openRequests: 0, avgDeliveryDays: 0,
      totalBillableHours: 0, outstandingInvoiceAmount: 0, requestsByStatus: {},
    })
    expect(Object.values(body.monthlyTrend).every(value => value === 0)).toBe(true)
  })

  it.each(['reports', 'invoices'])('requires the %s grant before issuing any report query', async feature => {
    access.viewableResources?.delete(feature)
    const response = await overview(new NextRequest('http://localhost/api/admin/reports/overview'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(fixture.queries).toEqual([])
    expect(resolveAccessScoping).not.toHaveBeenCalled()
  })

  it('keeps super-admin totals unrestricted', async () => {
    access = { ...access, level: 'super_admin', isSuperAdmin: true, isAdmin: true, viewableResources: null }
    vi.mocked(resolveAccessScoping).mockResolvedValue([])
    const body = await read<OverviewReport>(overview, 'overview')
    expect(body).toMatchObject({ totalClients: 2, totalRequests: 5, openRequests: 2,
      totalBillableHours: 82.5, outstandingInvoiceAmount: 1000, avgDeliveryDays: 46 })
    expect(resolveAccessScoping).not.toHaveBeenCalled()
  })
})

describe('sales reports scope deals and their history', () => {
  it('forecasts only permitted clients and unlinked studio deals', async () => {
    fixture.insert(schema.deals, { id: 'archived-a', org_id: ORG_A, stage_id: 'open', close_reason: 'archived', upfront_value_nzd: 10000, monthly_value_nzd: 999 })
    const body = await read<ForecastReport>(forecast, 'pipeline-forecast')
    expect(body).toMatchObject({ totalDeals: 4, unweightedUpfrontNzd: 1500,
      unweightedMonthlyNzd: 150, weightedUpfrontNzd: 750, weightedMonthlyNzd: 75 })
    expect(body.byStage.find((stage: { stageId: string }) => stage.stageId === 'open')).toMatchObject({ dealCount: 2, upfrontNzd: 1500, monthlyNzd: 150 })
  })

  it('scopes close-rate counts, won/lost history, and stage revenue', async () => {
    const body = await read<CloseRatesReport>(closeRates, 'close-rates')
    expect(body.revenueByStage.map((stage: { dealCount: number; totalValue: number }) =>
      [stage.dealCount, stage.totalValue],
    )).toEqual([[2, 1500], [1, 200], [1, 300]])
    expect(body.stageConversions[0]).toMatchObject({ entered: 4, converted: 2, conversionRate: 50 })
    expect(body.monthlyWinLoss.find((month: { month: string }) => month.month === '2026-10'))
      .toMatchObject({ won: 1, lost: 1, wonValue: 200, lostValue: 300 })
  })

  it('counts the permitted and unlinked open deals as two velocity samples', async () => {
    const body = await read<CloseRatesReport>(closeRates, 'close-rates')
    expect(body.stageVelocity.find(stage => stage.stageId === 'open'))
      .toMatchObject({ avgDays: 10, dealCount: 2 })
  })

  it('never derives stage velocity from another client activity history', async () => {
    // Two hidden transitions leak a duration even though the hidden deal itself was scoped out.
    for (const [id, createdAt] of [
      ['hidden-first', '2026-10-02T00:00:00.000Z'], ['hidden-next', '2026-10-08T00:00:00.000Z'],
    ]) fixture.insert(schema.activities, { id, deal_id: B_OPEN, type: 'stage_change', created_at: createdAt, description: 'Stage changed to Discovery' })
    const body = await read<CloseRatesReport>(closeRates, 'close-rates')
    expect(body.stageVelocity.find((stage: { stageId: string }) => stage.stageId === 'open'))
      .toMatchObject({ avgDays: 10, dealCount: 2 })
  })

  it('returns zero stage velocity samples when no deals are accessible, even with hidden history', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue([])
    for (const [id, createdAt] of [
      ['hidden-first', '2026-10-02T00:00:00.000Z'], ['hidden-next', '2026-10-08T00:00:00.000Z'],
    ]) fixture.insert(schema.activities, { id, deal_id: B_OPEN, type: 'stage_change', created_at: createdAt, description: 'Stage changed to Discovery' })
    const body = await read<CloseRatesReport>(closeRates, 'close-rates')
    expect(body.stageVelocity.find(stage => stage.stageId === 'open'))
      .toMatchObject({ avgDays: 0, dealCount: 0 })
  })

  it.each(['imported-history-deal', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'])(
    'uses stored metadata for the actual stage journey of %s', async dealId => {
      fixture.insert(schema.deals, {
        id: dealId, org_id: ORG_A, stage_id: 'lost',
        value_nzd: 1, upfront_value_nzd: 1, monthly_value_nzd: 0, created_at: CREATED,
      })
      fixture.insert(schema.activities, {
        id: 'history-created', deal_id: dealId, type: 'deal_created', created_at: CREATED,
        metadata: JSON.stringify({ initial: { stageId: 'open' } }),
      })
      fixture.insert(schema.activities, {
        id: 'history-lost', deal_id: dealId, type: 'stage_change',
        created_at: '2026-10-04T00:00:00.000Z', description: 'Stage changed to Lost',
        metadata: JSON.stringify({ before: { stageId: 'open' }, after: { stageId: 'lost' } }),
      })
      const body = await read<CloseRatesReport>(closeRates, 'close-rates')
      // The lost deal skipped Won. A NULL metadata substitution or ignored
      // non-UUID history would fall back to ordinal inference and count 3/5.
      expect(body.stageConversions[0]).toMatchObject({ entered: 5, converted: 2, conversionRate: 40 })
    },
  )

  it.each([forecast, closeRates])('returns no deal figures for deny-all scope', async handler => {
    vi.mocked(resolveAccessScoping).mockResolvedValue([])
    const body = await read<ForecastReport | CloseRatesReport>(handler, handler === forecast ? 'pipeline-forecast' : 'close-rates')
    if ('byStage' in body) {
      expect(body).toMatchObject({ totalDeals: 0, weightedUpfrontNzd: 0, weightedMonthlyNzd: 0 })
      expect(body.byStage.every((stage: { dealCount: number }) => stage.dealCount === 0)).toBe(true)
    } else {
      expect(body.revenueByStage.every((stage: { dealCount: number; totalValue: number }) => stage.dealCount === 0 && stage.totalValue === 0)).toBe(true)
      expect(body.stageConversions.every((stage: { entered: number; converted: number }) => stage.entered === 0 && stage.converted === 0)).toBe(true)
    }
  })

  it.each([forecast, closeRates])('denies reports.view alone access to sales analytics', async handler => {
    access.viewableResources = new Set(['reports', 'invoices'])
    const response = await handler(new NextRequest('http://localhost/api/admin/reports/sales'))
    expect(response.status).toBe(403)
    expect(fixture.queries).toEqual([])
    expect(resolveAccessScoping).not.toHaveBeenCalled()
  })

  it.each([forecast, closeRates])('keeps service-token reports unrestricted', async handler => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'api-service', orgId: 'org_tahi', sessionId: null })
    const body = await read<ForecastReport | CloseRatesReport>(handler, handler === forecast ? 'pipeline-forecast' : 'close-rates')
    if ('byStage' in body) expect(body).toMatchObject({ totalDeals: 7, weightedUpfrontNzd: 5250, weightedMonthlyNzd: 525 })
    else expect(body.revenueByStage[0]).toMatchObject({ dealCount: 3, totalValue: 10500 })
    expect(resolvePermissions).not.toHaveBeenCalled()
    expect(resolveAccessScoping).not.toHaveBeenCalled()
  })
})
