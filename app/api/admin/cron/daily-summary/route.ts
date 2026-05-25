/**
 * POST /api/admin/cron/daily-summary
 *
 * Fires once a day (typically 7am NZT via scheduled trigger). Computes
 * a day-over-day summary of dashboard activity and posts a single
 * in-app notification to the default lead owner so Liam sees it next
 * time he opens the dashboard.
 *
 * Captures:
 *   - New leads created yesterday
 *   - Leads scored yesterday + how many crossed the high-intent threshold
 *   - Enrichments completed yesterday
 *   - Calls held yesterday (status=completed since yesterday)
 *   - Calls scheduled for today
 *   - Replies sent yesterday
 *   - Deals promoted yesterday
 *
 * Idempotency: only one daily_summary notification per UTC day per
 * recipient. Re-running same day = no-op.
 *
 * Auth: admin session OR Bearer CRON_SECRET.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { logCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'

const HIGH_INTENT_THRESHOLD = 70

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const cronHeader = req.headers.get('x-cron-secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (!hasCronAuth) {
    const { orgId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const database = await db()

  // Recipient: default lead owner (typically Liam)
  const [recipientRow] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
    .limit(1)
  const recipient = recipientRow?.value?.trim()
  if (!recipient) {
    const summary = { skipped: 'No leads.defaultLeadOwnerId configured' }
    await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'daily-summary', 'skipped', Date.now() - t0, summary, null)
    return NextResponse.json(summary)
  }

  // Idempotency: skip if a daily_summary notification was already
  // pushed in the last 23h (allows the cron to retry within the same
  // calendar day without dup).
  const [existing] = await database
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(and(
      eq(schema.notifications.userId, recipient),
      eq(schema.notifications.eventType, 'daily_summary'),
      sql`${schema.notifications.createdAt} > datetime('now', '-23 hours')`,
    ))
    .limit(1)
  if (existing) {
    const summary = { skipped: 'daily_summary already sent in the last 23h' }
    await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'daily-summary', 'skipped', Date.now() - t0, summary, null)
    return NextResponse.json(summary)
  }

  // Window: previous calendar day, in UTC. (Liam's local 7am NZT
  // fires the cron, by which time "yesterday" UTC is roughly the
  // same as Liam's "yesterday afternoon and earlier".)
  const now = new Date()
  const yesterdayStart = new Date(now)
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1)
  yesterdayStart.setUTCHours(0, 0, 0, 0)
  const todayStart = new Date(now)
  todayStart.setUTCHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1)

  const yest = yesterdayStart.toISOString()
  const today = todayStart.toISOString()
  const tomorrow = tomorrowStart.toISOString()

  // Parallel-fetch all the metrics
  const [
    newLeadsRow,
    leadsScoredRow,
    highIntentRow,
    enrichmentsRow,
    callsHeldRow,
    callsTodayRow,
    repliesSentRow,
    promotedRow,
  ] = await Promise.all([
    // New leads created yesterday
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.leads)
      .where(and(
        gte(schema.leads.createdAt, yest),
        lte(schema.leads.createdAt, today),
      )),
    // Leads scored yesterday (lead_scored activities)
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.activities)
      .where(and(
        eq(schema.activities.type, 'lead_scored'),
        gte(schema.activities.createdAt, yest),
        lte(schema.activities.createdAt, today),
      )),
    // High-intent leads (score >= 70 right now, scored yesterday)
    database
      .select({ count: sql<number>`COUNT(DISTINCT ${schema.activities.leadId})` })
      .from(schema.activities)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.activities.leadId))
      .where(and(
        eq(schema.activities.type, 'lead_scored'),
        gte(schema.activities.createdAt, yest),
        lte(schema.activities.createdAt, today),
        gte(schema.leads.aiScore, HIGH_INTENT_THRESHOLD),
      )),
    // Enrichments yesterday
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.activities)
      .where(and(
        eq(schema.activities.type, 'lead_enriched'),
        gte(schema.activities.createdAt, yest),
        lte(schema.activities.createdAt, today),
      )),
    // Calls held yesterday — status='completed' updated in window
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.discoveryCalls)
      .where(and(
        eq(schema.discoveryCalls.status, 'completed'),
        gte(schema.discoveryCalls.scheduledAt, yest),
        lte(schema.discoveryCalls.scheduledAt, today),
      )),
    // Calls scheduled for today
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.discoveryCalls)
      .where(and(
        eq(schema.discoveryCalls.status, 'scheduled'),
        gte(schema.discoveryCalls.scheduledAt, today),
        lte(schema.discoveryCalls.scheduledAt, tomorrow),
      )),
    // Replies sent yesterday
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.aiReplyDrafts)
      .where(and(
        eq(schema.aiReplyDrafts.status, 'sent'),
        gte(schema.aiReplyDrafts.sentAt, yest),
        lte(schema.aiReplyDrafts.sentAt, today),
      )),
    // Lead promoted activities yesterday
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.activities)
      .where(and(
        eq(schema.activities.type, 'lead_promoted'),
        gte(schema.activities.createdAt, yest),
        lte(schema.activities.createdAt, today),
      )),
  ])

  const metrics = {
    newLeads: Number(newLeadsRow[0]?.count ?? 0),
    leadsScored: Number(leadsScoredRow[0]?.count ?? 0),
    highIntent: Number(highIntentRow[0]?.count ?? 0),
    enrichments: Number(enrichmentsRow[0]?.count ?? 0),
    callsHeld: Number(callsHeldRow[0]?.count ?? 0),
    callsToday: Number(callsTodayRow[0]?.count ?? 0),
    repliesSent: Number(repliesSentRow[0]?.count ?? 0),
    promoted: Number(promotedRow[0]?.count ?? 0),
  }

  // Skip the notification if absolutely nothing happened (avoids
  // notification fatigue on quiet days).
  const totalActivity = metrics.newLeads + metrics.leadsScored + metrics.enrichments
    + metrics.callsHeld + metrics.callsToday + metrics.repliesSent + metrics.promoted
  if (totalActivity === 0) {
    const summary = { skipped: 'No activity yesterday or today — quiet day' }
    await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'daily-summary', 'skipped', Date.now() - t0, summary, null)
    return NextResponse.json(summary)
  }

  // Compose body — top-line stats, no fluff
  const parts: string[] = []
  if (metrics.callsToday > 0) parts.push(`${metrics.callsToday} call${metrics.callsToday === 1 ? '' : 's'} today`)
  if (metrics.newLeads > 0) parts.push(`${metrics.newLeads} new lead${metrics.newLeads === 1 ? '' : 's'}`)
  if (metrics.highIntent > 0) parts.push(`${metrics.highIntent} high-intent`)
  if (metrics.enrichments > 0) parts.push(`${metrics.enrichments} enriched`)
  if (metrics.callsHeld > 0) parts.push(`${metrics.callsHeld} call${metrics.callsHeld === 1 ? '' : 's'} held`)
  if (metrics.repliesSent > 0) parts.push(`${metrics.repliesSent} repl${metrics.repliesSent === 1 ? 'y' : 'ies'} sent`)
  if (metrics.promoted > 0) parts.push(`${metrics.promoted} promoted to deal`)

  const body = parts.join(' · ')
  const dateLabel = yesterdayStart.toLocaleDateString('en-NZ', {
    weekday: 'short', day: 'numeric', month: 'short',
  })

  // Push notification
  await database.insert(schema.notifications).values({
    id: crypto.randomUUID(),
    userId: recipient,
    userType: 'team_member',
    eventType: 'daily_summary',
    title: `Daily summary · ${dateLabel}`,
    body,
    entityType: 'system',
    entityId: 'daily-summary',
    read: false,
    createdAt: new Date().toISOString(),
  })

  const summary = { recipient, dateLabel, metrics, body }
  await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'daily-summary', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
}
