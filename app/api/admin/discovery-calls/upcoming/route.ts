/**
 * GET /api/admin/discovery-calls/upcoming
 *
 * Returns the next N scheduled discovery calls (any parent: lead, deal,
 * request, task, org). This is what the homepage widget consumes: the
 * legacy /api/admin/calls only reads scheduled_calls (manual entries),
 * which misses everything Google Calendar sync writes into discovery_calls.
 *
 * Each row carries a denormalised `with` field for display ("Discovery
 * call with Acme") and a `meetingUrl` (Google Meet link). Parent type
 * is included so the UI can deep-link to the right page.
 *
 * ORG SCOPING (audit T1.19): results follow the caller's team-member access
 * rules via scopedOrgIds, matching app/api/admin/calls/index. Owners /
 * admins / the service token resolve to { kind: 'all' } and see everything,
 * unchanged. Restricted members only see calls whose org (direct, or via a
 * linked deal / request / task) is in their scope; pre-client calls with no
 * client linkage stay visible to anyone holding a scope. Deny-by-default
 * members get an empty list. See scope-upcoming.ts for the row decision.
 *
 * Query:
 *   ?limit=N  (default 5, max 50)
 *   ?includePast=1  (also include calls that started up to 30min ago,
 *                    useful for the "join now" widget)
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, asc, gte } from 'drizzle-orm'
import { scopedOrgIds } from '@/lib/access-scope'
import { columnInIds, orgColumnInScope } from '../../_scoping/org-scope'
import { keepUpcomingCallForScope, type ParentOrgIndex } from './scope-upcoming'

export const dynamic = 'force-dynamic'

interface AttendeeLite {
  name?: string
  email?: string
  role?: string
}

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await scopedOrgIds({ userId, orgId })
  if (scope.kind === 'none') return NextResponse.json({ calls: [] })

  const url = new URL(req.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 5
  const includePast = url.searchParams.get('includePast') === '1'

  const database = await db()

  // "Upcoming" means scheduled-status calls with a scheduledAt >= cutoff.
  // Cutoff is now (or now - 30min if includePast, so a meeting currently
  // running is still surfaced for the join button).
  //
  // We can't rely on SQLite's string comparison for scheduledAt here:
  // Google Calendar returns event start times in the calendar's local
  // timezone (e.g. "2026-05-25T21:00:00+12:00"), and lexicographic
  // ordering breaks once the offsets differ. A "9am NZT" call (UTC 21:00
  // prev day) lex-compares greater than "20:17Z", so the row leaks
  // through the gte() filter and shows up as "upcoming" hours after it
  // happened. Fix: pull a generous window with a cheap lex pre-filter,
  // then re-test in JS as Date numerics for correctness.
  const cutoffMs = Date.now() - (includePast ? 30 * 60_000 : 0)
  // Lex pre-filter against TODAY's UTC date midnight (good enough to
  // reduce row scan; everything before today is irrelevant). The JS
  // filter below catches any straggler the lex pass let through.
  const lexCutoff = new Date(cutoffMs - 36 * 60 * 60_000).toISOString()

  // A call with no orgId is kept by the SQL pass (includeNull) because it may
  // be pre-client (lead / unclassified); rows reaching an org through a linked
  // deal / request / task are re-checked in JS below, same shape as the
  // calls/index route.
  const conditions = [gte(schema.discoveryCalls.scheduledAt, lexCutoff)]
  if (scope.kind === 'some') {
    conditions.push(orgColumnInScope(schema.discoveryCalls.orgId, scope.orgIds, { includeNull: true }))
  }

  const calls = await database
    .select({
      id: schema.discoveryCalls.id,
      title: schema.discoveryCalls.title,
      scheduledAt: schema.discoveryCalls.scheduledAt,
      durationMinutes: schema.discoveryCalls.durationMinutes,
      googleMeetUrl: schema.discoveryCalls.googleMeetUrl,
      googleCalendarEventId: schema.discoveryCalls.googleCalendarEventId,
      attendees: schema.discoveryCalls.attendees,
      status: schema.discoveryCalls.status,
      // Parent identifiers: all nullable; one will be set
      leadId: schema.discoveryCalls.leadId,
      dealId: schema.discoveryCalls.dealId,
      requestId: schema.discoveryCalls.requestId,
      taskId: schema.discoveryCalls.taskId,
      orgId: schema.discoveryCalls.orgId,
    })
    .from(schema.discoveryCalls)
    .where(and(...conditions))
    .orderBy(asc(schema.discoveryCalls.scheduledAt))
    .limit(limit * 6)  // overfetch: JS filter strips past + non-scheduled

  // Real "is it past?" check in JS, plus status filter (see comment above).
  let candidates = calls.filter(
    c => c.status === 'scheduled' && new Date(c.scheduledAt).getTime() >= cutoffMs,
  )

  // Restricted caller: a null-orgId row can still reach a client through a
  // linked deal / request / task, so resolve those parents' orgs and drop any
  // row whose resolved orgs are not all in scope. Runs before the slice so a
  // scoped member still gets a full page of THEIR calls.
  if (scope.kind === 'some') {
    const nullOrg = candidates.filter(c => !c.orgId)
    const parentDealIds = [...new Set(nullOrg.map(c => c.dealId).filter((x): x is string => !!x))]
    const parentRequestIds = [...new Set(nullOrg.map(c => c.requestId).filter((x): x is string => !!x))]
    const parentTaskIds = [...new Set(nullOrg.map(c => c.taskId).filter((x): x is string => !!x))]

    type OrgRef = { id: string; orgId: string | null }
    const [parentDeals, parentRequests, parentTasks] = await Promise.all([
      parentDealIds.length > 0
        ? database.select({ id: schema.deals.id, orgId: schema.deals.orgId })
            .from(schema.deals)
            .where(columnInIds(schema.deals.id, parentDealIds))
        : Promise.resolve([] as OrgRef[]),
      parentRequestIds.length > 0
        ? database.select({ id: schema.requests.id, orgId: schema.requests.orgId })
            .from(schema.requests)
            .where(columnInIds(schema.requests.id, parentRequestIds))
        : Promise.resolve([] as OrgRef[]),
      parentTaskIds.length > 0
        ? database.select({ id: schema.tasks.id, orgId: schema.tasks.orgId })
            .from(schema.tasks)
            .where(columnInIds(schema.tasks.id, parentTaskIds))
        : Promise.resolve([] as OrgRef[]),
    ])
    const parents: ParentOrgIndex = {
      dealOrgById: new Map(parentDeals.map(r => [r.id, r.orgId])),
      requestOrgById: new Map(parentRequests.map(r => [r.id, r.orgId])),
      taskOrgById: new Map(parentTasks.map(r => [r.id, r.orgId])),
    }
    candidates = candidates.filter(c => keepUpcomingCallForScope(scope, c, parents))
  }

  const upcoming = candidates.slice(0, limit)

  // Denormalise the parent "with" field. Batch one query per parent type
  // for the rows we actually returned (max 5 typically).
  const leadIds = upcoming.map(c => c.leadId).filter((x): x is string => !!x)
  const dealIds = upcoming.map(c => c.dealId).filter((x): x is string => !!x)
  const orgIds = upcoming.map(c => c.orgId).filter((x): x is string => !!x)

  const [leadRows, dealRows, orgRows] = await Promise.all([
    leadIds.length > 0
      ? database.select({ id: schema.leads.id, name: schema.leads.name, company: schema.leads.company })
          .from(schema.leads)
      : Promise.resolve([] as Array<{ id: string; name: string; company: string | null }>),
    dealIds.length > 0
      ? database.select({ id: schema.deals.id, title: schema.deals.title, orgId: schema.deals.orgId })
          .from(schema.deals)
      : Promise.resolve([] as Array<{ id: string; title: string; orgId: string | null }>),
    orgIds.length > 0
      ? database.select({ id: schema.organisations.id, name: schema.organisations.name })
          .from(schema.organisations)
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ])

  const leadById = new Map(leadRows.filter(l => leadIds.includes(l.id)).map(l => [l.id, l]))
  const dealById = new Map(dealRows.filter(d => dealIds.includes(d.id)).map(d => [d.id, d]))
  const orgById = new Map(orgRows.filter(o => orgIds.includes(o.id)).map(o => [o.id, o]))

  // Resolve org name via deal.orgId for deal-attached calls without
  // a direct orgId on the call row.
  const dealOrgIds = dealRows.filter(d => dealIds.includes(d.id) && d.orgId).map(d => d.orgId as string)
  const dealOrgs = dealOrgIds.length > 0
    ? await database.select({ id: schema.organisations.id, name: schema.organisations.name })
        .from(schema.organisations)
    : []
  const dealOrgById = new Map(dealOrgs.filter(o => dealOrgIds.includes(o.id)).map(o => [o.id, o]))

  const enriched = upcoming.map(c => {
    let withName: string | null = null
    let withSubtitle: string | null = null
    let parentType: 'lead' | 'deal' | 'org' | 'request' | 'task' | null = null
    let parentId: string | null = null
    let parentHref: string | null = null

    if (c.leadId) {
      const l = leadById.get(c.leadId)
      withName = l?.name ?? null
      withSubtitle = l?.company ?? null
      parentType = 'lead'
      parentId = c.leadId
      parentHref = `/leads/${c.leadId}`
    } else if (c.dealId) {
      const d = dealById.get(c.dealId)
      withName = d?.title ?? null
      if (d?.orgId) {
        const o = dealOrgById.get(d.orgId)
        withSubtitle = o?.name ?? null
      }
      parentType = 'deal'
      parentId = c.dealId
      parentHref = `/deals?deal=${c.dealId}`
    } else if (c.orgId) {
      const o = orgById.get(c.orgId)
      withName = o?.name ?? null
      parentType = 'org'
      parentId = c.orgId
      parentHref = `/clients/${c.orgId}`
    } else if (c.requestId) {
      withName = c.title
      parentType = 'request'
      parentId = c.requestId
      parentHref = `/requests/${c.requestId}`
    } else if (c.taskId) {
      withName = c.title
      parentType = 'task'
      parentId = c.taskId
      parentHref = `/tasks?task=${c.taskId}`
    }

    // Parse attendees (JSON array) and pull email-bearing entries that
    // aren't the host: these are the "with X" candidates if we lack a
    // parent name (e.g. uncategorised Google Calendar import).
    let attendeesParsed: AttendeeLite[] = []
    try {
      const raw = JSON.parse(c.attendees ?? '[]')
      if (Array.isArray(raw)) {
        attendeesParsed = raw.filter((a): a is AttendeeLite => !!a && typeof a === 'object')
      }
    } catch { /* ignore */ }

    if (!withName) {
      const guest = attendeesParsed.find(a => a.role !== 'host' && a.email) ?? attendeesParsed[0]
      withName = guest?.name ?? guest?.email ?? c.title
    }

    return {
      id: c.id,
      title: c.title,
      scheduledAt: c.scheduledAt,
      durationMinutes: c.durationMinutes,
      meetingUrl: c.googleMeetUrl,
      attendees: attendeesParsed,
      withName,
      withSubtitle,
      parentType,
      parentId,
      parentHref,
      fromCalendar: !!c.googleCalendarEventId,
    }
  })

  return NextResponse.json({ calls: enriched })
}
