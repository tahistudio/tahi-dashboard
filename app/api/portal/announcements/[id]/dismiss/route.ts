import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { refusePreviewWrite } from '@/lib/acting-as'

type Params = { params: Promise<{ id: string }> }

// POST /api/portal/announcements/[id]/dismiss
//
// CLOSED in both preview modes, and moved off getRequestAuth to see them at
// all. Under Client view this used to run as the ADMIN's own Clerk id, so
// dismissing a banner while looking at a client's portal quietly hid it from
// the operator's real studio session. Self-scoped and harmless in effect, but
// it was the one portal write that ignored the mode entirely, and "the rule has
// an exception nobody remembers" is how the next exception gets added.
//
// Not opened for acting either: a dismissal is a per-person "I have seen this",
// and there is no honest person to write it as. The studio member's own
// dismissal is not the client's.
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await getPortalAuth(req)
  const { userId } = auth
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const previewDenied = refusePreviewWrite(auth)
  if (previewDenied) return previewDenied

  const { id: announcementId } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Validate the announcement exists before recording a dismissal, so a client
  // cannot insert unbounded dismissal rows referencing arbitrary/non-existent
  // ids (invalid-FK table bloat).
  const [announcement] = await drizzle
    .select({ id: schema.announcements.id })
    .from(schema.announcements)
    .where(eq(schema.announcements.id, announcementId))
    .limit(1)
  if (!announcement) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Check if already dismissed
  const existing = await drizzle
    .select()
    .from(schema.announcementDismissals)
    .where(
      and(
        eq(schema.announcementDismissals.announcementId, announcementId),
        eq(schema.announcementDismissals.userId, userId)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    return NextResponse.json({ success: true })
  }

  await drizzle.insert(schema.announcementDismissals).values({
    announcementId,
    userId,
    dismissedAt: new Date().toISOString(),
  })

  return NextResponse.json({ success: true })
}
