import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// POST /api/portal/announcements/[id]/dismiss
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await getRequestAuth(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: announcementId } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
