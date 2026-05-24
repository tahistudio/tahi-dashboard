/**
 * POST /api/admin/cron/affiliate-reactivation
 *
 * Finds affiliate codes that brought in leads in the past but haven't
 * sent any in the last N days (default 60). For each: pushes a single
 * notification to the default lead owner suggesting Liam reach out to
 * the affiliate to re-engage them.
 *
 * No formal affiliates table yet — we identify affiliates by the
 * distinct values in leads.affiliateCode. When an affiliates table
 * lands later, swap the source here. The notification dedup window
 * (30 days per code) keeps the noise bounded regardless.
 *
 * Settings:
 *   affiliates.reactivationDays  (number, default 60) idle window
 *   affiliates.reactivationEnabled (bool, default true) master toggle
 *
 * Auth: admin session OR Bearer CRON_SECRET.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, isNotNull, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface AffiliateAggregate {
  affiliateCode: string
  totalLeads: number
  lastLeadAt: string
  promotedLeads: number
}

export async function POST(req: NextRequest) {
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

  // Settings: idle window + master toggle
  const [enabledRow, daysRow] = await Promise.all([
    database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'affiliates.reactivationEnabled'))
      .limit(1),
    database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'affiliates.reactivationDays'))
      .limit(1),
  ])

  if (enabledRow[0]?.value === 'false') {
    return NextResponse.json({ skipped: 'affiliates.reactivationEnabled is disabled' })
  }
  const idleDays = Number.isFinite(Number(daysRow[0]?.value)) ? Number(daysRow[0]?.value) : 60
  const cutoff = new Date(Date.now() - idleDays * 24 * 60 * 60_000).toISOString()

  // Recipient
  const [recipientRow] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
    .limit(1)
  const recipient = recipientRow?.value?.trim()
  if (!recipient) {
    return NextResponse.json({ skipped: 'No leads.defaultLeadOwnerId — nowhere to send notifications' })
  }

  // Aggregate by affiliateCode
  const rows = await database
    .select({
      affiliateCode: schema.leads.affiliateCode,
      totalLeads: sql<number>`COUNT(*)`,
      lastLeadAt: sql<string>`MAX(${schema.leads.createdAt})`,
      promotedLeads: sql<number>`SUM(CASE WHEN ${schema.leads.status} = 'promoted' THEN 1 ELSE 0 END)`,
    })
    .from(schema.leads)
    .where(isNotNull(schema.leads.affiliateCode))
    .groupBy(schema.leads.affiliateCode)

  const aggregates: AffiliateAggregate[] = rows
    .map(r => ({
      affiliateCode: r.affiliateCode ?? '',
      totalLeads: Number(r.totalLeads ?? 0),
      lastLeadAt: r.lastLeadAt ?? '',
      promotedLeads: Number(r.promotedLeads ?? 0),
    }))
    .filter(a => a.affiliateCode && a.totalLeads > 0)

  // Identify stale affiliates: last lead older than cutoff
  const stale = aggregates.filter(a => a.lastLeadAt < cutoff)

  if (stale.length === 0) {
    return NextResponse.json({
      scanned: aggregates.length,
      stale: 0,
      notified: 0,
      idleDays,
    })
  }

  // Dedup: skip codes we've already notified about in the last 30 days
  const recent = await database
    .select({ entityId: schema.notifications.entityId })
    .from(schema.notifications)
    .where(and(
      eq(schema.notifications.eventType, 'affiliate_reactivation'),
      sql`${schema.notifications.createdAt} > datetime('now', '-30 days')`,
    ))
  const alreadyNotified = new Set(recent.map(r => r.entityId))

  const toNotify = stale.filter(a => !alreadyNotified.has(`affiliate:${a.affiliateCode}`))

  // Push one notification per stale affiliate (capped at 5 per run to
  // avoid notification flood on a fresh setup).
  const cappedNotify = toNotify.slice(0, 5)
  for (const aff of cappedNotify) {
    const daysSince = Math.floor((Date.now() - new Date(aff.lastLeadAt).getTime()) / (24 * 60 * 60_000))
    await database.insert(schema.notifications).values({
      id: crypto.randomUUID(),
      userId: recipient,
      userType: 'team_member',
      eventType: 'affiliate_reactivation',
      title: `Reactivate affiliate: ${aff.affiliateCode}`,
      body: `${aff.totalLeads} total leads, ${aff.promotedLeads} promoted. Last lead ${daysSince} days ago.`,
      entityType: 'affiliate',
      entityId: `affiliate:${aff.affiliateCode}`,
      read: false,
      createdAt: new Date().toISOString(),
    })
  }

  return NextResponse.json({
    scanned: aggregates.length,
    stale: stale.length,
    notified: cappedNotify.length,
    deferredToNextRun: toNotify.length - cappedNotify.length,
    idleDays,
    samples: stale.slice(0, 10).map(a => ({
      affiliateCode: a.affiliateCode,
      totalLeads: a.totalLeads,
      promotedLeads: a.promotedLeads,
      daysSinceLast: Math.floor((Date.now() - new Date(a.lastLeadAt).getTime()) / (24 * 60 * 60_000)),
    })),
  })
}
