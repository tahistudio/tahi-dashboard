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
 * No body required. Read-only Client view is refused: a super admin merely
 * LOOKING must not stamp a receipt in the client's name.
 *
 * Act as client is allowed, but the receipt is written with userType
 * 'team_member' and the studio member's own id. A studio person opening the
 * page is not the client having seen it, so the row says what actually
 * happened rather than resetting the client's own unread badge for them.
 */

import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { actingIdentity, recordActingWrite, refusePreviewWrite } from '@/lib/acting-as'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await getPortalAuth(req)
  const { orgId, userId, clerkOrgId } = auth

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied
  const previewDenied = refusePreviewWrite(auth, { allowActing: true })
  if (previewDenied) return previewDenied
  const acting = actingIdentity(auth)

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

  // The reader, named honestly. Acting for a client, the row is the studio
  // member's own receipt (their team_members id, userType 'team_member'), which
  // is exactly what the admin-side route would have written. Faking the
  // client's receipt would clear an unread badge the client never looked at.
  const readerId = acting ? acting.adminTeamMemberId : userId
  const readerType: 'team_member' | 'contact' = acting ? 'team_member' : 'contact'

  const [existing] = await drizzle
    .select({ id: schema.requestReads.id })
    .from(schema.requestReads)
    .where(and(
      eq(schema.requestReads.requestId, id),
      eq(schema.requestReads.userId, readerId),
      eq(schema.requestReads.userType, readerType),
    ))
    .limit(1)

  if (existing) {
    // A touch, not an event. The request detail page posts here about two
    // seconds after every mount, so recording each one would bury the trail
    // this mode exists to produce under rows that changed nothing: open five
    // requests twice and the acting log is nine tenths receipts. The receipt
    // row itself already names the studio member honestly, and the audit row
    // for the FIRST look is below.
    await drizzle
      .update(schema.requestReads)
      .set({ lastReadAt: now })
      .where(eq(schema.requestReads.id, existing.id))
  } else {
    // The record first, then the receipt: same ordering as every other acting
    // write, so a failed record leaves nothing behind. Only the first look at
    // a request is worth a row.
    await recordActingWrite(drizzle as unknown as DB, acting, {
      verb: 'request.read',
      entityType: 'request',
      entityId: id,
      route: 'POST /api/portal/requests/[id]/reads',
      extra: { lastReadAt: now, first: true },
    })

    await drizzle.insert(schema.requestReads).values({
      id: crypto.randomUUID(),
      requestId: id,
      userId: readerId,
      userType: readerType,
      lastReadAt: now,
    })
  }

  return NextResponse.json({ ok: true, lastReadAt: now })
}
