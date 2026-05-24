/**
 * POST /api/admin/leads/[id]/calls
 *
 * Schedule a discovery call against a lead. Writes a discoveryCalls row
 * and stamps a lead_call_scheduled activity so the lead timeline shows
 * the event.
 *
 * Body:
 *   title         (required)
 *   scheduledAt   (required, ISO 8601)
 *   durationMinutes (default 30)
 *   googleMeetUrl (optional — paste from Google Calendar)
 *   googleCalendarEventId (optional — set when wired via Calendar sync)
 *   attendees     (optional, JSON array of {name, email, role})
 *
 * GET /api/admin/leads/[id]/calls — list calls for the lead (newest
 * scheduled date first). Same data lives on the GET /leads/[id]
 * payload too; this endpoint exists for callers that just want the
 * call list without re-fetching the lead.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()

  const calls = await database
    .select()
    .from(schema.discoveryCalls)
    .where(eq(schema.discoveryCalls.leadId, id))
    .orderBy(desc(schema.discoveryCalls.scheduledAt))

  return NextResponse.json({ calls })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: {
    title?: string
    scheduledAt?: string
    durationMinutes?: number
    googleMeetUrl?: string | null
    googleCalendarEventId?: string | null
    attendees?: Array<{ name?: string; email?: string; role?: string }>
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.scheduledAt) {
    return NextResponse.json({ error: 'scheduledAt is required (ISO 8601)' }, { status: 400 })
  }
  // Sanity-check the timestamp parses.
  const scheduledDate = new Date(body.scheduledAt)
  if (Number.isNaN(scheduledDate.getTime())) {
    return NextResponse.json({ error: 'scheduledAt is not a valid date' }, { status: 400 })
  }

  const database = await db()

  // Confirm the lead exists so we don't end up with orphan calls.
  const leadExists = await database
    .select({ id: schema.leads.id, name: schema.leads.name })
    .from(schema.leads)
    .where(eq(schema.leads.id, id))
    .limit(1)
  if (leadExists.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  const callId = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.discoveryCalls).values({
    id: callId,
    leadId: id,
    title: body.title.trim(),
    scheduledAt: body.scheduledAt,
    durationMinutes: body.durationMinutes ?? 30,
    googleMeetUrl: body.googleMeetUrl?.trim() || null,
    googleCalendarEventId: body.googleCalendarEventId?.trim() || null,
    attendees: JSON.stringify(body.attendees ?? []),
    status: 'scheduled',
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  // Activity row — picks up in the lead timeline as "Call scheduled".
  await database.insert(schema.activities).values({
    id: crypto.randomUUID(),
    type: 'lead_call_scheduled',
    title: `Call scheduled: ${body.title.trim()}`,
    description: `For ${scheduledDate.toISOString()}`,
    leadId: id,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id: callId }, { status: 201 })
}
