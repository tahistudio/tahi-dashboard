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
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { createCallForParent, listCallsForParent } from '@/lib/calls'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'leads')
  if (featureDenied) return featureDenied

  const { id } = await params
  const database = await db()
  const calls = await listCallsForParent(database, 'lead', id)
  return NextResponse.json({ calls })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'leads')
  if (featureDenied) return featureDenied
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

  const database = await db()

  // Confirm the lead exists so we don't end up with orphan calls.
  const leadExists = await database
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(eq(schema.leads.id, id))
    .limit(1)
  if (leadExists.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  try {
    const { id: callId } = await createCallForParent(database, 'lead', id, {
      title: body.title ?? '',
      scheduledAt: body.scheduledAt ?? '',
      durationMinutes: body.durationMinutes,
      googleMeetUrl: body.googleMeetUrl,
      googleCalendarEventId: body.googleCalendarEventId,
      attendees: body.attendees,
    }, userId)
    return NextResponse.json({ id: callId }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create call'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
