/**
 * GET + POST /api/admin/requests/[id]/calls
 *
 * Calls attached to a request (kickoff, scope review, mid-build check-in).
 * Shared logic in lib/calls.ts. Note that the activity hook is skipped
 * for requests — requests have their own message stream, not the unified
 * activities table.
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
  const calls = await listCallsForParent(database, 'request', id)
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
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (exists.length === 0) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  try {
    const { id: callId } = await createCallForParent(database, 'request', id, {
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
