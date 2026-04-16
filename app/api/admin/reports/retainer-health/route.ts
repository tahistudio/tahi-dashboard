import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, gte, sql, inArray } from 'drizzle-orm'
import { buildRateMap, toNzd } from '@/lib/currency'
import { getOrgScope } from '@/lib/require-access'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/reports/retainer-health
 *
 * Per retainer client returns health metrics plus a churn risk score.
 * Retainer = org with customMrr > 0 OR an active subscription row.
 *
 * Response: { clients: [{
 *   orgId, orgName, status, healthStatus, mrrNzd, monthsActive,
 *   openRequests, requestsLast30d, requestsLast90d,
 *   billableHoursLast30d, hoursPerMonth (if configured),
 *   utilizationPct (hours / hoursPerMonth),
 *   churnRiskScore (0-100), upsellSignal (bool),
 * }] }
 */
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const drizzle = (await db()) as D1

  // Apply team-member scoping so a restricted PM only sees their clients here
  const scope = await getOrgScope(drizzle, userId)
  if (scope !== null && scope.length === 0) {
    return NextResponse.json({ clients: [] })
  }

  // Load all active orgs with their mrr + status (raw SQL so we can LEFT JOIN
  // subscriptions and pull custom_mrr in one pass).
  type RawRow = {
    id: string
    name: string
    status: string
    health_status: string | null
    preferred_currency: string | null
    custom_mrr: number | null
    billing_model: string | null
    retainer_end_date: string | null
    created_at: string
    plan_type: string | null
    sub_status: string | null
    sub_started: string | null
  }

  // Try with billing_model column first (migration 0016). Fall back to
  // the old query without it if the column doesn't exist yet.
  let orgsRaw: RawRow[] | null = null
  try {
    orgsRaw = await drizzle.all<RawRow>(sql`
      SELECT
        o.id, o.name, o.status, o.health_status, o.preferred_currency,
        o.custom_mrr, o.billing_model, o.retainer_end_date, o.created_at,
        s.plan_type, s.status as sub_status, s.current_period_start as sub_started
      FROM organisations o
      LEFT JOIN subscriptions s
        ON s.org_id = o.id AND s.status = 'active'
      WHERE o.status != 'archived'
    `)
  } catch {
    // billing_model / retainer_end_date columns don't exist yet (pre-0016)
    orgsRaw = await drizzle.all<RawRow>(sql`
      SELECT
        o.id, o.name, o.status, o.health_status, o.preferred_currency,
        o.custom_mrr, NULL as billing_model, NULL as retainer_end_date, o.created_at,
        s.plan_type, s.status as sub_status, s.current_period_start as sub_started
      FROM organisations o
      LEFT JOIN subscriptions s
        ON s.org_id = o.id AND s.status = 'active'
      WHERE o.status != 'archived'
    `)
  }

  // Only show clients that are explicitly retainer-billed (billingModel = 'retainer')
  // OR have a legacy customMrr set with no billingModel specified.
  // Hourly clients (Elevate) should NOT appear here even if they have
  // customMrr set for forecast purposes (their MRR is an estimated average,
  // not a contractual commitment).
  const retainerOrgs = (orgsRaw ?? []).filter(o => {
    // Explicitly hourly or project = never show in retainer health
    if (o.billing_model === 'hourly' || o.billing_model === 'project') return false
    // Must have MRR or active subscription to be a retainer
    return (o.custom_mrr && o.custom_mrr > 0) || o.sub_status === 'active'
  })
  const scopedOrgs = scope === null
    ? retainerOrgs
    : retainerOrgs.filter(o => scope.includes(o.id))

  if (scopedOrgs.length === 0) return NextResponse.json({ clients: [] })

  const orgIds = scopedOrgs.map(o => o.id)

  // Currency conversion
  const rateMap = buildRateMap(await drizzle.select().from(schema.exchangeRates))

  // Request counts per org
  const now = new Date()
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const d90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const [openCounts, r30, r90] = await Promise.all([
    drizzle
      .select({ orgId: schema.requests.orgId, c: sql<number>`COUNT(*)`.as('c') })
      .from(schema.requests)
      .where(and(
        inArray(schema.requests.orgId, orgIds),
        sql`${schema.requests.status} NOT IN ('delivered', 'archived', 'cancelled')`,
      ))
      .groupBy(schema.requests.orgId),
    drizzle
      .select({ orgId: schema.requests.orgId, c: sql<number>`COUNT(*)`.as('c') })
      .from(schema.requests)
      .where(and(
        inArray(schema.requests.orgId, orgIds),
        gte(schema.requests.createdAt, d30),
      ))
      .groupBy(schema.requests.orgId),
    drizzle
      .select({ orgId: schema.requests.orgId, c: sql<number>`COUNT(*)`.as('c') })
      .from(schema.requests)
      .where(and(
        inArray(schema.requests.orgId, orgIds),
        gte(schema.requests.createdAt, d90),
      ))
      .groupBy(schema.requests.orgId),
  ])

  const openMap = new Map(openCounts.map(r => [r.orgId, Number(r.c)]))
  const r30Map = new Map(r30.map(r => [r.orgId, Number(r.c)]))
  const r90Map = new Map(r90.map(r => [r.orgId, Number(r.c)]))

  // Billable hours last 30d per org (join timeEntries -> requests)
  const hours30 = await drizzle.all<{ org_id: string; total: number }>(sql`
    SELECT r.org_id as org_id, COALESCE(SUM(t.hours), 0) as total
    FROM time_entries t
    INNER JOIN requests r ON t.request_id = r.id
    WHERE r.org_id IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})
      AND t.billable = 1
      AND t.date >= ${d30.slice(0, 10)}
    GROUP BY r.org_id
  `)
  const hours30Map = new Map((hours30 ?? []).map(r => [r.org_id, r.total ?? 0]))

  // Plan hours lookup — hardcoded per plan type, since subscription schema
  // doesn't store included hours directly.
  const PLAN_HOURS: Record<string, number> = {
    maintain: 10,
    scale: 20,
    tune: 40,
    launch: 80,
  }

  const results = scopedOrgs.map(o => {
    const mrrNzd = o.custom_mrr
      ? toNzd(o.custom_mrr, o.preferred_currency ?? 'NZD', rateMap)
      : 0

    const monthsActive = Math.max(1, Math.floor(
      (now.getTime() - new Date(o.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30)
    ))

    const openRequests = openMap.get(o.id) ?? 0
    const requestsLast30d = r30Map.get(o.id) ?? 0
    const requestsLast90d = r90Map.get(o.id) ?? 0
    const billableHoursLast30d = hours30Map.get(o.id) ?? 0
    const hoursPerMonth = o.plan_type ? PLAN_HOURS[o.plan_type] ?? null : null
    const utilizationPct = hoursPerMonth
      ? (billableHoursLast30d / hoursPerMonth) * 100
      : null

    // Churn risk score: start at 20, add signals
    let churnRisk = 20
    if (o.status === 'paused') churnRisk += 40
    if (o.health_status === 'red') churnRisk += 25
    else if (o.health_status === 'amber') churnRisk += 10
    if (requestsLast30d === 0) churnRisk += 25
    if (requestsLast90d === 0) churnRisk += 15 // stacks with above
    if (utilizationPct !== null && utilizationPct < 30) churnRisk += 15
    if (openRequests === 0 && requestsLast30d === 0) churnRisk += 5
    churnRisk = Math.min(100, churnRisk)

    // Upsell signal: consistently high utilization = room to upgrade plan
    const upsellSignal = utilizationPct !== null && utilizationPct > 120

    return {
      orgId: o.id,
      orgName: o.name,
      status: o.status,
      healthStatus: o.health_status,
      planType: o.plan_type,
      mrrNzd,
      currency: o.preferred_currency ?? 'NZD',
      monthsActive,
      openRequests,
      requestsLast30d,
      requestsLast90d,
      billableHoursLast30d,
      hoursPerMonth,
      utilizationPct,
      churnRiskScore: churnRisk,
      upsellSignal,
    }
  })

  // Sort highest churn risk first
  results.sort((a, b) => b.churnRiskScore - a.churnRiskScore)

  return NextResponse.json({ clients: results })
}
