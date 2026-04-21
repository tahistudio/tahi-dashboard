/**
 * POST /api/admin/requests/[id]/reads
 *
 * Marks the request as read by the current user (now). Upserts into
 * request_reads (one row per user per request). Called by the request
 * detail page ~2 seconds after load so a quick glance doesn't count.
 *
 * No body required.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'No user' }, { status: 400 })

  const { id } = await params
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

  const now = new Date().toISOString()

  const [existing] = await drizzle
    .select({ id: schema.requestReads.id })
    .from(schema.requestReads)
    .where(and(
      eq(schema.requestReads.requestId, id),
      eq(schema.requestReads.userId, userId),
      eq(schema.requestReads.userType, 'team_member'),
    ))
    .limit(1)

  if (existing) {
    await drizzle
      .update(schema.requestReads)
      .set({ lastReadAt: now })
      .where(eq(schema.requestReads.id, existing.id))
  } else {
    await drizzle.insert(schema.requestReads).values({
      id: crypto.randomUUID(),
      requestId: id,
      userId,
      userType: 'team_member',
      lastReadAt: now,
    })
  }

  return NextResponse.json({ ok: true, lastReadAt: now })
}
