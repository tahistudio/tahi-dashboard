/**
 * POST /api/portal/requests/[id]/reads
 *
 * The client half of read state. Mirrors the admin route
 * (app/api/admin/requests/[id]/reads/route.ts) exactly, with userType
 * 'contact' instead of 'team_member', so one request_reads table carries both
 * sides of the conversation: the studio can see that the client opened the
 * thread, and the client's own unread badge has something to reset against.
 *
 * Called by the request detail page ~2 seconds after load, so a bounce off the
 * page does not count as read.
 *
 * No body required. Impersonation ("view as client") is refused: a super admin
 * standing in a client's shoes must not stamp a receipt in their name.
 */

import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId, impersonating, clerkOrgId } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as Drizzle

  // Same scoping the rest of the portal request surface uses: the caller's own
  // org, and never a Tahi-internal request.
  const [request] = await drizzle
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.id, id),
      eq(schema.requests.orgId, orgId),
      eq(schema.requests.isInternal, false),
    ))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()

  const [existing] = await drizzle
    .select({ id: schema.requestReads.id })
    .from(schema.requestReads)
    .where(and(
      eq(schema.requestReads.requestId, id),
      eq(schema.requestReads.userId, userId),
      eq(schema.requestReads.userType, 'contact'),
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
      userType: 'contact',
      lastReadAt: now,
    })
  }

  return NextResponse.json({ ok: true, lastReadAt: now })
}
