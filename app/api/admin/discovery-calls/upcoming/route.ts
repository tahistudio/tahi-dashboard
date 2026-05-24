/**
 * GET /api/admin/discovery-calls/upcoming
 *
 * Returns the next N scheduled discovery calls (any parent: lead, deal,
 * request, task, org). This is what the homepage widget consumes — the
 * legacy /api/admin/calls only reads scheduled_calls (manual entries),
 * which misses everything Google Calendar sync writes into discovery_calls.
 *
 * Each row carries a denormalised `with` field for display ("Discovery
 * call with Acme") and a `meetingUrl` (Google Meet link). Parent type
 * is included so the UI can deep-link to the right page.
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
import { eq, asc, gte } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface AttendeeLite {
  name?: string
  email?: string
  role?: string
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 5
  const includePast = url.searchParams.get('includePast') === '1'

  const database = await db()

  // "Upcoming" means scheduled-status calls with a scheduledAt >= cutoff.
  // Cutoff is now (or now - 30min if includePast, so a meeting currently
  // running is still surfaced for the join button).
  const cutoff = new Date(Date.now() - (includePast ? 30 * 60_000 : 0)).toISOString()

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
      // Parent identifiers — all nullable; one will be set
      leadId: schema.discoveryCalls.leadId,
      dealId: schema.discoveryCalls.dealId,
      requestId: schema.discoveryCalls.requestId,
      taskId: schema.discoveryCalls.taskId,
      orgId: schema.discoveryCalls.orgId,
    })
    .from(schema.discoveryCalls)
    .where(gte(schema.discoveryCalls.scheduledAt, cutoff))
    .orderBy(asc(schema.discoveryCalls.scheduledAt))
    .limit(limit * 3)  // overfetch — we'll filter to status=scheduled below

  // Filter to scheduled only (rescheduled / cancelled / completed should
  // never appear in "upcoming"). Drizzle's where can't easily combine
  // gte + eq across nullable values cleanly here, so post-filter.
  const upcoming = calls.filter(c => c.status === 'scheduled').slice(0, limit)

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
    // aren't the host — these are the "with X" candidates if we lack a
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
