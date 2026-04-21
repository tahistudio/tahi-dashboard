/**
 * /api/admin/requests/[id]/participants/[participantId]
 *
 *   DELETE → soft-remove a participant (sets removedAt). Preserves the row
 *            so @mention history + audit log resolution still work.
 *
 * `participantId` here is the **row id** of the requestParticipants row,
 * not the person's id. Use GET /participants to get the row ids.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, isNull } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string; participantId: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, participantId } = await params
  const database = await db()
  const drizzle = database as Drizzle

  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  const result = await drizzle
    .update(schema.requestParticipants)
    .set({ removedAt: new Date().toISOString() })
    .where(and(
      eq(schema.requestParticipants.id, participantId),
      eq(schema.requestParticipants.requestId, id),
      isNull(schema.requestParticipants.removedAt),
    ))

  return NextResponse.json({ ok: true, changes: result })
}
