import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'

// GET /api/admin/calls - list calls
// Query: ?orgId=xxx&status=scheduled
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')
  const filterStatus = url.searchParams.get('status')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100)

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const conditions = []
  if (filterOrgId) {
    conditions.push(eq(schema.scheduledCalls.orgId, filterOrgId))
  }
  if (filterStatus) {
    conditions.push(eq(schema.scheduledCalls.status, filterStatus))
  }

  const calls = await drizzle
    .select({
      id: schema.scheduledCalls.id,
      orgId: schema.scheduledCalls.orgId,
      orgName: schema.organisations.name,
      title: schema.scheduledCalls.title,
      description: schema.scheduledCalls.description,
      scheduledAt: schema.scheduledCalls.scheduledAt,
      durationMinutes: schema.scheduledCalls.durationMinutes,
      meetingUrl: schema.scheduledCalls.meetingUrl,
      attendees: schema.scheduledCalls.attendees,
      status: schema.scheduledCalls.status,
      notes: schema.scheduledCalls.notes,
      recordingUrl: schema.scheduledCalls.recordingUrl,
      createdAt: schema.scheduledCalls.createdAt,
    })
    .from(schema.scheduledCalls)
    .leftJoin(schema.organisations, eq(schema.scheduledCalls.orgId, schema.organisations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(schema.scheduledCalls.scheduledAt))
    .limit(limit)

  return NextResponse.json({ calls })
}

// POST /api/admin/calls - create a call
// Two-way Google Calendar sync: if Google is connected, also create the
// event on the user's primary calendar so it shows up there + on every
// attendee's calendar. We store the returned google_calendar_event_id
// + the auto-generated Meet link back on our row so the home page
// widget (which reads discovery_calls) sees it instantly.
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    orgId?: string
    title?: string
    description?: string
    scheduledAt?: string
    durationMinutes?: number
    meetingUrl?: string
    attendees?: Array<{ id: string; type: string; name: string; email: string }>
  }

  if (!body.orgId?.trim()) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.scheduledAt?.trim()) {
    return NextResponse.json({ error: 'scheduledAt is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const duration = body.durationMinutes ?? 30
  const title = body.title.trim()
  const description = body.description?.trim() || null
  const attendees = body.attendees ?? []
  let meetingUrl: string | null = body.meetingUrl?.trim() || null
  let googleEventId: string | null = null
  let calendarPushError: string | null = null

  // Push to Google Calendar first so we can save the event id and the
  // auto-generated Meet link with the row. Failures don't block the
  // local insert — we still create the call and surface a warning.
  const database = await db()
  try {
    const { getGoogleAccessToken, createCalendarEvent, GoogleNotConnectedError } =
      await import('@/lib/google')
    try {
      const tokens = await getGoogleAccessToken(database)
      const attendeeEmails = attendees.map(a => a.email).filter(Boolean)
      const event = await createCalendarEvent(tokens.accessToken, {
        title,
        description,
        startIso: body.scheduledAt,
        durationMinutes: duration,
        attendeeEmails,
      })
      googleEventId = event.id ?? null
      // Prefer caller's meeting URL; fall back to the Meet link Google made.
      if (!meetingUrl) {
        meetingUrl = event.hangoutLink
          ?? event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri
          ?? null
      }
    } catch (err) {
      if (err instanceof GoogleNotConnectedError) {
        calendarPushError = 'google_not_connected'
      } else {
        calendarPushError = err instanceof Error ? err.message : String(err)
      }
    }
  } catch {
    // Module import failure — treat as disconnected.
    calendarPushError = 'google_unavailable'
  }

  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Insert into legacy scheduled_calls (existing readers depend on it).
  await drizzle.insert(schema.scheduledCalls).values({
    id,
    orgId: body.orgId,
    title,
    description,
    scheduledAt: body.scheduledAt,
    durationMinutes: duration,
    meetingUrl,
    attendees: JSON.stringify(attendees),
    status: 'scheduled',
    createdById: userId ?? 'system',
    createdAt: now,
    updatedAt: now,
  })

  // Also write a discovery_calls row so the unified home-page widget +
  // /calls index see this call without waiting for the next pull-sync.
  // googleCalendarEventId is what dedupes future pull-syncs from
  // creating a duplicate (sync upserts by that key).
  try {
    await drizzle.insert(schema.discoveryCalls).values({
      id: crypto.randomUUID(),
      orgId: body.orgId,
      title,
      scheduledAt: body.scheduledAt,
      durationMinutes: duration,
      status: 'scheduled',
      meetingType: 'client',
      googleCalendarEventId: googleEventId,
      googleMeetUrl: meetingUrl,
      attendees: JSON.stringify(attendees.map(a => ({
        name: a.name,
        email: a.email,
        role: a.type,
      }))),
      createdById: userId ?? 'system',
      createdAt: now,
      updatedAt: now,
    })
  } catch {
    // If discovery_calls insert fails (schema mismatch on older D1s
    // without the columns) we still consider the call created — the
    // pull-sync will reconcile it later via googleCalendarEventId.
  }

  return NextResponse.json({
    id,
    googleEventId,
    meetingUrl,
    calendarPushed: !calendarPushError,
    calendarPushError,
  }, { status: 201 })
}
