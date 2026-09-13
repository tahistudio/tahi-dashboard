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
import { scopedOrgIds } from '@/lib/access-scope'
import { columnInIds, isOrgInScope, orgColumnInScope } from '../../_scoping/org-scope'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const scope = await scopedOrgIds({ userId, orgId })
  if (scope.kind === 'none') return NextResponse.json({ items: [] })

  const url = new URL(req.url)
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')
  const type = url.searchParams.get('type')

  const database = await db() as unknown as D1

  // discovery_calls (the unified surface). Joins to leads / deals / orgs
  // for parent labels. Limit to ±60 days unless overridden.
  // Window: ±60 days. We pre-filter on the lex bounds (gte/lte) for
  // index efficiency, but the calls index UI re-bins "upcoming vs past"
  // in JS using real Date comparison — that side-steps the lex-vs-tz
  // mismatch when Google returns local-timezone offsets (e.g. NZT
  // "2026-05-25T21:00:00+12:00" lex-compares greater than "20:17Z" even
  // though it's hours in the past). See discovery-calls/upcoming/route.ts
  // for the matching fix and rationale.
  const defaultSince = new Date(Date.now() - 60 * 86400_000).toISOString()
  const defaultUntil = new Date(Date.now() + 60 * 86400_000).toISOString()

  const conditions = [
    gte(schema.discoveryCalls.scheduledAt, since ?? defaultSince),
    lte(schema.discoveryCalls.scheduledAt, until ?? defaultUntil),
  ]
  if (type) conditions.push(eq(schema.discoveryCalls.meetingType, type))
  // A call with no orgId is a pre-client call (lead / deal / unclassified), so
  // it follows the same rule as an unlinked deal: visible to anyone with a
  // scope. Rows linked to a deal are re-checked against that deal's org below.
  if (scope.kind === 'some') {
    conditions.push(orgColumnInScope(schema.discoveryCalls.orgId, scope.orgIds, { includeNull: true }))
  }

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
      requestId: schema.discoveryCalls.requestId,
      requestTitle: schema.requests.title,
      orgId: schema.discoveryCalls.orgId,
      orgName: schema.organisations.name,
    })
    .from(schema.discoveryCalls)
    .leftJoin(schema.leads, eq(schema.discoveryCalls.leadId, schema.leads.id))
    .leftJoin(schema.deals, eq(schema.discoveryCalls.dealId, schema.deals.id))
    .leftJoin(schema.requests, eq(schema.discoveryCalls.requestId, schema.requests.id))
    .leftJoin(schema.organisations, eq(schema.discoveryCalls.orgId, schema.organisations.id))
    .where(and(...conditions))
    .orderBy(desc(schema.discoveryCalls.scheduledAt))

  // A deal- or request-linked call can carry a null orgId while its deal
  // or request points at a client. Resolve those so a restricted caller
  // cannot read another client's call (or its request title) through
  // either join.
  let visibleRows = dRows
  if (scope.kind === 'some') {
    const dealIds = [...new Set(
      dRows.filter(r => !r.orgId && r.dealId).map(r => r.dealId as string),
    )]
    const dealOrgById = new Map<string, string | null>()
    if (dealIds.length > 0) {
      const dealOrgRows = await database
        .select({ id: schema.deals.id, orgId: schema.deals.orgId })
        .from(schema.deals)
        .where(columnInIds(schema.deals.id, dealIds))
      for (const d of dealOrgRows) dealOrgById.set(d.id, d.orgId)
    }

    const requestIds = [...new Set(
      dRows.filter(r => !r.orgId && r.requestId).map(r => r.requestId as string),
    )]
    const requestOrgById = new Map<string, string | null>()
    if (requestIds.length > 0) {
      const requestOrgRows = await database
        .select({ id: schema.requests.id, orgId: schema.requests.orgId })
        .from(schema.requests)
        .where(columnInIds(schema.requests.id, requestIds))
      for (const r of requestOrgRows) requestOrgById.set(r.id, r.orgId)
    }

    visibleRows = dRows.filter(r => {
      if (r.orgId) return true
      // No direct org: a call with neither a deal nor a request link is a
      // genuinely pre-client call (lead-only / unclassified), visible to
      // anyone with any scope at all. One with a deal and/or a request
      // link inherits that parent's org for scoping instead - a scoped
      // caller must not read another client's deal or request title
      // through the join.
      if (!r.dealId && !r.requestId) {
        return isOrgInScope(scope, null, 'allow-if-any-scope')
      }
      if (r.dealId && !isOrgInScope(scope, dealOrgById.get(r.dealId) ?? null, 'allow-if-any-scope')) {
        return false
      }
      if (r.requestId && !isOrgInScope(scope, requestOrgById.get(r.requestId) ?? null, 'allow-if-any-scope')) {
        return false
      }
      return true
    })
  }

  // Surface lifecycle hints: hasTranscript bool, isClassified bool.
  const items = visibleRows.map(r => ({
    ...r,
    source: 'discovery_calls' as const,
    hasTranscript: !!r.hasTranscript,
    isClassified: !!r.meetingType,
  }))

  return NextResponse.json({ items })
}
