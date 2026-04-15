import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql, eq, and, gte, inArray } from 'drizzle-orm'
import { buildRateMap, toNzd } from '@/lib/currency'
import { createNotifications } from '@/lib/notifications'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/reports/retainer-alerts
 *
 * Recomputes retainer health (same logic as /api/admin/reports/retainer-health)
 * and fires admin notifications for any client where:
 *   - churnRiskScore >= 70  (churn risk alert)
 *   - upsellSignal is true  (upsell opportunity alert)
 *
 * Dedupe rule: skip if an unread notification of the same type for the same
 * orgId already exists from the last 14 days. Prevents weekly sync spam.
 *
 * This endpoint is designed to be triggered by cron (e.g. nightly) but can
 * be hit on-demand for testing.
 *
 * Response: { fired: number, skipped: number, alerts: [{ orgId, type, reason }] }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const drizzle = (await db()) as D1

  // Find admin recipients (Tahi team members with role='admin')
  const admins = await drizzle
    .select({ id: schema.teamMembers.clerkUserId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.role, 'admin'))

  const recipients = admins
    .filter(a => a.id)
    .map(a => ({ userId: a.id as string, userType: 'team_member' as const }))

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No admin team members with clerkUserId — nothing to notify' }, { status: 400 })
  }

  // Same retainer set as /reports/retainer-health
  type RawRow = {
    id: string; name: string; status: string; health_status: string | null
    preferred_currency: string | null; custom_mrr: number | null
    plan_type: string | null; sub_status: string | null
  }
  const orgsRaw = await drizzle.all<RawRow>(sql`
    SELECT
      o.id, o.name, o.status, o.health_status, o.preferred_currency,
      o.custom_mrr, s.plan_type, s.status as sub_status
    FROM organisations o
    LEFT JOIN subscriptions s ON s.org_id = o.id AND s.status = 'active'
    WHERE o.status != 'archived'
  `)
  const retainerOrgs = (orgsRaw ?? []).filter(o =>
    (o.custom_mrr && o.custom_mrr > 0) || o.sub_status === 'active'
  )
  if (retainerOrgs.length === 0) return NextResponse.json({ fired: 0, skipped: 0, alerts: [] })

  const orgIds = retainerOrgs.map(o => o.id)

  const rateMap = buildRateMap(await drizzle.select().from(schema.exchangeRates))

  const now = new Date()
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const d14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const r30 = await drizzle
    .select({ orgId: schema.requests.orgId, c: sql<number>`COUNT(*)`.as('c') })
    .from(schema.requests)
    .where(and(
      inArray(schema.requests.orgId, orgIds),
      gte(schema.requests.createdAt, d30),
    ))
    .groupBy(schema.requests.orgId)
  const r30Map = new Map(r30.map(r => [r.orgId, Number(r.c)]))

  // Billable hours last 30d per org
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

  const PLAN_HOURS: Record<string, number> = { maintain: 10, scale: 20, tune: 40, launch: 80 }

  // Collect alerts
  const alerts: Array<{ orgId: string; orgName: string; type: 'retainer_churn_risk' | 'retainer_upsell_opportunity'; reason: string; mrrNzd: number }> = []

  for (const o of retainerOrgs) {
    const requestsLast30d = r30Map.get(o.id) ?? 0
    const billable30 = hours30Map.get(o.id) ?? 0
    const hoursPerMonth = o.plan_type ? PLAN_HOURS[o.plan_type] ?? null : null
    const utilizationPct = hoursPerMonth ? (billable30 / hoursPerMonth) * 100 : null
    const mrrNzd = o.custom_mrr ? toNzd(o.custom_mrr, o.preferred_currency ?? 'NZD', rateMap) : 0

    // Churn risk same scoring as retainer-health
    let churnRisk = 20
    if (o.status === 'paused') churnRisk += 40
    if (o.health_status === 'red') churnRisk += 25
    else if (o.health_status === 'amber') churnRisk += 10
    if (requestsLast30d === 0) churnRisk += 25
    if (utilizationPct !== null && utilizationPct < 30) churnRisk += 15

    if (churnRisk >= 70) {
      const reasonParts: string[] = []
      if (o.status === 'paused') reasonParts.push('subscription paused')
      if (requestsLast30d === 0) reasonParts.push('no requests in 30d')
      if (utilizationPct !== null && utilizationPct < 30) reasonParts.push(`${utilizationPct.toFixed(0)}% utilisation`)
      if (o.health_status === 'red') reasonParts.push('health red')
      alerts.push({
        orgId: o.id,
        orgName: o.name,
        type: 'retainer_churn_risk',
        reason: reasonParts.join(', ') || 'multiple risk factors',
        mrrNzd,
      })
    }

    if (utilizationPct !== null && utilizationPct > 120) {
      alerts.push({
        orgId: o.id,
        orgName: o.name,
        type: 'retainer_upsell_opportunity',
        reason: `${utilizationPct.toFixed(0)}% over plan capacity (${billable30.toFixed(1)}h vs ${hoursPerMonth}h)`,
        mrrNzd,
      })
    }
  }

  // Dedupe: pull existing unread retainer notifications from last 14d and skip dupes
  const existingRecent = await drizzle
    .select({ eventType: schema.notifications.eventType, entityId: schema.notifications.entityId })
    .from(schema.notifications)
    .where(and(
      gte(schema.notifications.createdAt, d14),
      inArray(schema.notifications.eventType, ['retainer_churn_risk', 'retainer_upsell_opportunity']),
    ))
  const seen = new Set(existingRecent.map(r => `${r.eventType}|${r.entityId}`))

  const fired: typeof alerts = []
  const skipped: typeof alerts = []

  for (const a of alerts) {
    const key = `${a.type}|${a.orgId}`
    if (seen.has(key)) {
      skipped.push(a)
      continue
    }
    const title = a.type === 'retainer_churn_risk'
      ? `Churn risk: ${a.orgName}`
      : `Upsell opportunity: ${a.orgName}`
    const mrrLabel = a.mrrNzd > 0
      ? ` Worth NZD ${Math.round(a.mrrNzd).toLocaleString()}/mo.`
      : ''
    await createNotifications(drizzle, recipients, {
      type: a.type,
      title,
      body: `${a.reason}.${mrrLabel}`,
      entityType: 'organisation',
      entityId: a.orgId,
    })
    fired.push(a)
  }

  return NextResponse.json({
    fired: fired.length,
    skipped: skipped.length,
    alerts: fired,
    skippedAlerts: skipped,
    recipients: recipients.length,
  })
}
