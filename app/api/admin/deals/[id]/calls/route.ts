/**
 * GET + POST /api/admin/deals/[id]/calls
 *
 * Same shape as /api/admin/leads/[id]/calls but for deal-stage calls
 * (kickoff, scope refinement, proposal walkthrough, multi-meeting deal
 * conversations). Shared logic lives in lib/calls.ts.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createCallForParent, listCallsForParent } from '@/lib/calls'
import { requireDealAccess } from '../../_access'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'deals')
  if (featureDenied) return featureDenied

  const { id } = await params
  const database = await db()

  const denied = await requireDealAccess(database as unknown as D1, { userId, orgId }, id)
  if (denied) return denied

  const calls = await listCallsForParent(database, 'deal', id)
  return NextResponse.json({ calls })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'deals')
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

  const denied = await requireDealAccess(database as unknown as D1, { userId, orgId }, id)
  if (denied) return denied

  try {
    const { id: callId } = await createCallForParent(database, 'deal', id, {
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
