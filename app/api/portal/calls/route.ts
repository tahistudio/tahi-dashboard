import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { createElement } from 'react'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc, gte } from 'drizzle-orm'
import { notifyAllAdmins } from '@/lib/notifications'
import { sendEmail } from '@/lib/email'
import { publicUrl } from '@/lib/app-url'
import { formatSlotSummary, resolveTimeZone } from '@/lib/kickoff-slot'
import { mergeUpcomingCalls, type RawPortalCall } from '@/lib/portal-calls'
import KickoffBookedEmail from '@/emails/kickoff-booked'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface AttendeeLite {
  id?: string
  type?: string
  name?: string
  email?: string
  role?: string
}

interface CallItem {
  id: string
  title: string
  whenISO: string
  durationMin: number
  meetingUrl: string | null
  withName: string | null
  avatar: string | null
}

function parseAttendees(raw: string | null): AttendeeLite[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AttendeeLite[]) : []
  } catch {
    return []
  }
}

// Choose the person to show as "with" — the host / team member if we can tell,
// else the first named attendee.
function pickWith(attendees: AttendeeLite[]): AttendeeLite | null {
  const host = attendees.find(
    (a) => a.role === 'host' || a.type === 'team_member',
  )
  if (host?.name) return host
  const named = attendees.find((a) => !!a.name)
  return named ?? null
}

// ── GET /api/portal/calls ────────────────────────────────────────────────────
// Upcoming scheduled + discovery calls for the caller's org, next first, with a
// join link where one exists. Backs the client "Next call" card and the calls
// NeedsYou item. Scoped to the org; the Tahi admin org is rejected. Honest empty
// [] when nothing is booked (the UI falls back to the booking CTA). Read-only.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20) : 5

  const database = await db()
  const drizzle = database as D1

  // A call currently in its first 30 minutes still counts as "upcoming" so the
  // Join button surfaces while a meeting is live. Org calls are low-volume, so
  // we filter with real Date numerics in JS (Google returns local-tz offsets,
  // which makes lexicographic comparison unreliable near boundaries).
  const cutoffMs = Date.now() - 30 * 60_000

  type RawCall = RawPortalCall // shape shared with lib/portal-calls

  let scheduled: RawCall[] = []
  try {
    scheduled = await drizzle
      .select({
        id: schema.scheduledCalls.id,
        title: schema.scheduledCalls.title,
        scheduledAt: schema.scheduledCalls.scheduledAt,
        durationMinutes: schema.scheduledCalls.durationMinutes,
        meetingUrl: schema.scheduledCalls.meetingUrl,
        attendees: schema.scheduledCalls.attendees,
      })
      .from(schema.scheduledCalls)
      .where(and(
        eq(schema.scheduledCalls.orgId, orgId),
        eq(schema.scheduledCalls.status, 'scheduled'),
      ))
      .orderBy(asc(schema.scheduledCalls.scheduledAt))
      .limit(limit * 6)
  } catch {
    scheduled = []
  }

  let discovery: RawCall[] = []
  try {
    discovery = await drizzle
      .select({
        id: schema.discoveryCalls.id,
        title: schema.discoveryCalls.title,
        scheduledAt: schema.discoveryCalls.scheduledAt,
        durationMinutes: schema.discoveryCalls.durationMinutes,
        meetingUrl: schema.discoveryCalls.googleMeetUrl,
        attendees: schema.discoveryCalls.attendees,
      })
      .from(schema.discoveryCalls)
      .where(and(
        eq(schema.discoveryCalls.orgId, orgId),
        eq(schema.discoveryCalls.status, 'scheduled'),
      ))
      .orderBy(asc(schema.discoveryCalls.scheduledAt))
      .limit(limit * 6)
  } catch {
    discovery = []
  }

  // One entry per real meeting. A booking writes both tables, so without the
  // collapse the same call appears twice and a stale mirror can sort ahead of
  // the row a re-book moved.
  const merged = mergeUpcomingCalls(scheduled, discovery, { cutoffMs, limit })

  // Resolve avatars by matching attendee emails to Tahi team members.
  const emails = new Set<string>()
  for (const c of merged) {
    for (const a of parseAttendees(c.attendees)) {
      if (a.email) emails.add(a.email.toLowerCase())
    }
  }
  const avatarByEmail = new Map<string, string>()
  if (emails.size > 0) {
    try {
      const members = await drizzle
        .select({ email: schema.teamMembers.email, avatarUrl: schema.teamMembers.avatarUrl })
        .from(schema.teamMembers)
      for (const m of members) {
        const key = m.email?.toLowerCase()
        if (key && emails.has(key) && m.avatarUrl) avatarByEmail.set(key, m.avatarUrl)
      }
    } catch {
      // team_members unreadable — leave avatars null.
    }
  }

  const items: CallItem[] = merged.map((c) => {
    const attendee = pickWith(parseAttendees(c.attendees))
    const avatar = attendee?.email ? avatarByEmail.get(attendee.email.toLowerCase()) ?? null : null
    return {
      id: `${c.source}:${c.id}`,
      title: c.title.trim() || 'Call',
      whenISO: c.scheduledAt,
      durationMin: c.durationMinutes ?? 30,
      meetingUrl: c.meetingUrl ?? null,
      withName: attendee?.name ?? null,
      avatar,
    }
  })

  return NextResponse.json({ items })
}

// ── POST /api/portal/calls ───────────────────────────────────────────────────
// The client books a call with the studio. Today's only caller is the kickoff
// step at the end of onboarding, which used to pick a slot and write nothing
// (ship readiness audit, Tier 1 item 19).
//
// Writes a real scheduled_calls row scoped to the caller's own org (the org
// comes from the session, never from the body), mirrors it into discovery_calls
// so the studio's unified calls surfaces see it, notifies the team, and emails
// the client their confirmation. Refuses the Tahi org and client-view
// impersonation, like every portal write.
//
// Re-booking is idempotent per org + title: picking another slot moves the
// existing upcoming call instead of stacking duplicates. The mirror is keyed to
// the same id and moves with it, so the two tables cannot disagree about when
// the meeting is (the studio's /calls index reads the mirror exclusively).
//
// `timeZone` is the visitor's own IANA zone. The picker promises wall-clock in
// their timezone, and this worker runs in UTC, so every artefact that outlives
// the screen (the confirmation email, the studio's bell row) is formatted
// against it rather than against the runtime's clock.
export async function POST(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  let body: {
    scheduledAt?: unknown
    title?: unknown
    durationMinutes?: unknown
    notes?: unknown
    timeZone?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawWhen = typeof body.scheduledAt === 'string' ? body.scheduledAt.trim() : ''
  const whenMs = rawWhen ? new Date(rawWhen).getTime() : Number.NaN
  if (!rawWhen || !Number.isFinite(whenMs)) {
    return NextResponse.json({ error: 'scheduledAt must be an ISO timestamp' }, { status: 400 })
  }
  // Tolerate a few minutes of client clock skew, refuse a booking in the past.
  if (whenMs < Date.now() - 5 * 60_000) {
    return NextResponse.json({ error: 'scheduledAt must be in the future' }, { status: 400 })
  }
  const scheduledAt = new Date(whenMs).toISOString()

  const title = (typeof body.title === 'string' && body.title.trim()) || 'Kickoff call'
  const rawDuration = typeof body.durationMinutes === 'number' ? body.durationMinutes : 30
  const durationMinutes = Number.isFinite(rawDuration)
    ? Math.min(240, Math.max(15, Math.round(rawDuration)))
    : 30
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  // Unknown or missing zones fall back to the studio's own clock, never to the
  // worker's UTC runtime.
  const timeZone = resolveTimeZone(typeof body.timeZone === 'string' ? body.timeZone : null)
  const description = `Booked by the client from onboarding (${timeZone}).`

  const database = await db()
  const drizzle = database as D1
  const now = new Date().toISOString()

  // Who booked it, and which workspace they belong to. Both from the session.
  let contact: { id: string; name: string; email: string } | null = null
  let orgName = 'your workspace'
  try {
    const [row] = await drizzle
      .select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.clerkUserId, userId), eq(schema.contacts.orgId, orgId)))
      .limit(1)
    contact = row ?? null
  } catch {
    contact = null
  }
  try {
    const [org] = await drizzle
      .select({ name: schema.organisations.name })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1)
    if (org?.name) orgName = org.name
  } catch {
    // fall back to the generic label
  }

  // The studio host: the org's project manager, resolved through the same join
  // /api/admin/clients/[id]/pm reads. Absent is fine, the studio triages it.
  let host: { id: string; name: string; email: string } | null = null
  try {
    const [pm] = await drizzle
      .select({
        id: schema.teamMembers.id,
        name: schema.teamMembers.name,
        email: schema.teamMembers.email,
      })
      .from(schema.teamMemberAccess)
      .innerJoin(
        schema.teamMemberAccessOrgs,
        eq(schema.teamMemberAccessOrgs.accessId, schema.teamMemberAccess.id),
      )
      .innerJoin(
        schema.teamMembers,
        eq(schema.teamMembers.id, schema.teamMemberAccess.teamMemberId),
      )
      .where(and(
        eq(schema.teamMemberAccess.role, 'project_manager'),
        eq(schema.teamMemberAccessOrgs.orgId, orgId),
      ))
      .limit(1)
    host = pm ?? null
  } catch {
    host = null
  }

  const attendees = [
    ...(contact
      ? [{ id: contact.id, type: 'contact', name: contact.name, email: contact.email, role: 'guest' }]
      : []),
    ...(host
      ? [{ id: host.id, type: 'team_member', name: host.name, email: host.email, role: 'host' }]
      : []),
  ]

  // Move an existing upcoming call of the same name rather than stacking a
  // second one when the client goes back and picks another slot.
  let existingId: string | null = null
  try {
    const [row] = await drizzle
      .select({ id: schema.scheduledCalls.id })
      .from(schema.scheduledCalls)
      .where(and(
        eq(schema.scheduledCalls.orgId, orgId),
        eq(schema.scheduledCalls.status, 'scheduled'),
        eq(schema.scheduledCalls.title, title),
        gte(schema.scheduledCalls.scheduledAt, now),
      ))
      .limit(1)
    existingId = row?.id ?? null
  } catch {
    existingId = null
  }

  const id = existingId ?? crypto.randomUUID()
  try {
    if (existingId) {
      await drizzle
        .update(schema.scheduledCalls)
        .set({
          scheduledAt,
          durationMinutes,
          description,
          attendees: JSON.stringify(attendees),
          ...(notes ? { notes } : {}),
          updatedAt: now,
        })
        .where(eq(schema.scheduledCalls.id, existingId))
    } else {
      await drizzle.insert(schema.scheduledCalls).values({
        id,
        orgId,
        title,
        description,
        scheduledAt,
        durationMinutes,
        meetingUrl: null,
        attendees: JSON.stringify(attendees),
        status: 'scheduled',
        notes,
        createdById: userId,
        createdAt: now,
        updatedAt: now,
      })
    }
  } catch (err) {
    console.error('[POST /api/portal/calls] could not write the call', err)
    return NextResponse.json({ error: 'Could not book that time' }, { status: 500 })
  }

  // Mirror into discovery_calls so the studio's unified calls widget and the
  // /calls index see it immediately (that index reads discovery_calls only).
  // The mirror carries the SAME id as the scheduled row, so a re-book moves one
  // row instead of leaving a stale twin behind for both sides to read. Best
  // effort, exactly like the admin route.
  const mirrorAttendees = JSON.stringify(
    attendees.map(a => ({ name: a.name, email: a.email, role: a.type })),
  )
  try {
    const [mirror] = await drizzle
      .select({ id: schema.discoveryCalls.id })
      .from(schema.discoveryCalls)
      .where(eq(schema.discoveryCalls.id, id))
      .limit(1)
    if (mirror) {
      await drizzle
        .update(schema.discoveryCalls)
        .set({
          title,
          scheduledAt,
          durationMinutes,
          status: 'scheduled',
          attendees: mirrorAttendees,
          updatedAt: now,
        })
        .where(eq(schema.discoveryCalls.id, id))
    } else {
      await drizzle.insert(schema.discoveryCalls).values({
        id,
        orgId,
        title,
        scheduledAt,
        durationMinutes,
        status: 'scheduled',
        meetingType: 'client',
        attendees: mirrorAttendees,
        createdById: userId,
        createdAt: now,
        updatedAt: now,
      })
    }
  } catch {
    // Older D1s without the columns still have the scheduled_calls row.
  }

  // Tell the studio, in the client's own clock rather than a raw ISO string.
  const whenForHumans = formatSlotSummary(scheduledAt, { timeZone, withZone: true }) || scheduledAt
  try {
    await notifyAllAdmins(drizzle, {
      type: 'call_scheduled',
      title: `${orgName} booked a ${title.toLowerCase()}`,
      body: `${contact?.name ?? 'A client'} picked ${whenForHumans}.`,
      entityType: 'call',
      entityId: id,
    })
  } catch {
    // non-fatal
  }

  // Confirm to the client. Non-fatal when Resend is not configured.
  let emailed = false
  if (contact?.email) {
    try {
      const result = await sendEmail(
        contact.email,
        'Your kickoff call is booked',
        createElement(KickoffBookedEmail, {
          contactFirstName: contact.name.split(' ')[0] || 'there',
          companyName: orgName,
          scheduledAt,
          timeZone,
          durationMinutes,
          hostName: host?.name ?? null,
          meetingUrl: null,
          portalUrl: publicUrl('/overview'),
        }),
        undefined,
        { template: 'kickoff-booked', orgId },
      )
      emailed = result.success
    } catch (err) {
      console.error('[POST /api/portal/calls] confirmation email failed', err)
    }
  }

  return NextResponse.json({ id, scheduledAt, timeZone, durationMinutes, emailed }, { status: 201 })
}
