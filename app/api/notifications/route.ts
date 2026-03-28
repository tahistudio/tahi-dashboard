import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and } from 'drizzle-orm'

// ── GET /api/notifications ────────────────────────────────────────────────────
// Returns the 20 most recent notifications for the authenticated user.
export async function GET(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const items = await drizzle
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(20)

  const unreadCount = items.filter(n => !n.read).length

  return NextResponse.json({ items, unreadCount })
}

// ── PATCH /api/notifications ──────────────────────────────────────────────────
// Mark notifications as read.
// Body: { id?: string, all?: boolean }
//   - { all: true }  marks every notification for the user as read
//   - { id: "..." }  marks a single notification as read
export async function PATCH(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as { id?: string; all?: boolean }

  if (!body.id && !body.all) {
    return NextResponse.json({ error: 'Provide id or all: true' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  if (body.all) {
    await drizzle
      .update(schema.notifications)
      .set({ read: true })
      .where(eq(schema.notifications.userId, userId))
  } else if (body.id) {
    await drizzle
      .update(schema.notifications)
      .set({ read: true })
      .where(
        and(
          eq(schema.notifications.id, body.id),
          eq(schema.notifications.userId, userId),
        )
      )
  }

  return NextResponse.json({ success: true })
}
