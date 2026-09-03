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
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Calls on a request are that client's calls, so both handlers resolve the
 *  owning request's org and check the caller's scope before they run. */
async function guardRequestAccess(
  database: Drizzle,
  userId: string | null,
  requestId: string,
): Promise<NextResponse | null> {
  const [owner] = await database
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)
  if (!owner) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  return requireAccessToOrg(database, userId, owner.orgId)
}

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const database = await db()

  const denied = await guardRequestAccess(database as Drizzle, userId, id)
  if (denied) return denied

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
  const denied = await guardRequestAccess(database as Drizzle, userId, id)
  if (denied) return denied

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
