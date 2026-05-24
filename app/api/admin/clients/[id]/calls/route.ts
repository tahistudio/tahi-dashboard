/**
 * GET + POST /api/admin/clients/[id]/calls
 *
 * Calls attached to a client / organisation (regular check-ins, QBRs,
 * upsell conversations). Activity hook writes to activities.orgId so
 * the client timeline picks it up.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { createCallForParent, listCallsForParent } from '@/lib/calls'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const database = await db()
  const calls = await listCallsForParent(database, 'org', id)
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

  const database = await db()
  const exists = await database
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, id))
    .limit(1)
  if (exists.length === 0) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  try {
    const { id: callId } = await createCallForParent(database, 'org', id, {
      title: body.title ?? '',
      scheduledAt: body.scheduledAt ?? '',
      durationMinutes: body.durationMinutes,
      googleMeetUrl: body.googleMeetUrl,
      googleCalendarEventId: body.googleCalendarEventId,
      attendees: body.attendees,
    }, userId)
    return NextResponse.json({ id: callId }, { status: 201 })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Failed to create call',
    }, { status: 400 })
  }
}
