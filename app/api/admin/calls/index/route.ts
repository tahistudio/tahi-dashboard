/**
 * GET /api/admin/calls/index
 *
 * Unified list of every call — reads from both `discovery_calls`
 * (post-calendar-sync universal table with meetingType) and the legacy
 * `scheduled_calls` (org-only check-ins). Surfaces parent context (lead
 * name / org name / deal title) so the /calls index page can render
 * one DataTable with classified rows.
 *
 * Query: ?since=ISO&until=ISO&type=discovery|client|partnership|unclassified
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, gte, lte } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')
  const type = url.searchParams.get('type')

  const database = await db() as unknown as D1

  // discovery_calls (the unified surface). Joins to leads / deals / orgs
  // for parent labels. Limit to ±60 days unless overridden.
  const defaultSince = new Date(Date.now() - 60 * 86400_000).toISOString()
  const defaultUntil = new Date(Date.now() + 60 * 86400_000).toISOString()

  const conditions = [
    gte(schema.discoveryCalls.scheduledAt, since ?? defaultSince),
    lte(schema.discoveryCalls.scheduledAt, until ?? defaultUntil),
  ]
  if (type) conditions.push(eq(schema.discoveryCalls.meetingType, type))

  const dRows = await database
    .select({
      id: schema.discoveryCalls.id,
      title: schema.discoveryCalls.title,
      scheduledAt: schema.discoveryCalls.scheduledAt,
      durationMinutes: schema.discoveryCalls.durationMinutes,
      status: schema.discoveryCalls.status,
      meetingType: schema.discoveryCalls.meetingType,
      outcome: schema.discoveryCalls.outcome,
      hasTranscript: schema.discoveryCalls.transcript,
      googleMeetUrl: schema.discoveryCalls.googleMeetUrl,
      googleCalendarEventId: schema.discoveryCalls.googleCalendarEventId,
      leadId: schema.discoveryCalls.leadId,
      leadName: schema.leads.name,
      dealId: schema.discoveryCalls.dealId,
      dealTitle: schema.deals.title,
      orgId: schema.discoveryCalls.orgId,
      orgName: schema.organisations.name,
    })
    .from(schema.discoveryCalls)
    .leftJoin(schema.leads, eq(schema.discoveryCalls.leadId, schema.leads.id))
    .leftJoin(schema.deals, eq(schema.discoveryCalls.dealId, schema.deals.id))
    .leftJoin(schema.organisations, eq(schema.discoveryCalls.orgId, schema.organisations.id))
    .where(and(...conditions))
    .orderBy(desc(schema.discoveryCalls.scheduledAt))

  // Surface lifecycle hints: hasTranscript bool, isClassified bool.
  const items = dRows.map(r => ({
    ...r,
    source: 'discovery_calls' as const,
    hasTranscript: !!r.hasTranscript,
    isClassified: !!r.meetingType,
  }))

  return NextResponse.json({ items })
}
