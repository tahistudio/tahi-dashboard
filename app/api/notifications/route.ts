import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, count } from 'drizzle-orm'

// How many rows the popover renders. The unread COUNT is deliberately not
// derived from this page (see below).
const PAGE_SIZE = 20

// ── GET /api/notifications ────────────────────────────────────────────────────
// Returns the 20 most recent notifications for the authenticated user, plus the
// true unread count.
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
    .limit(PAGE_SIZE)

  // Counted over the whole table, not over the page above. Filtering the 20
  // rows we happened to load reported 50 unread as 20, which is the number the
  // bell's aria-label reads out.
  const [unread] = await drizzle
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(
      eq(schema.notifications.userId, userId),
      eq(schema.notifications.read, false),
    ))

  return NextResponse.json({ items, unreadCount: Number(unread?.n ?? 0) })
}

// ── PATCH /api/notifications ──────────────────────────────────────────────────
// Mark notifications as read.
// Body: { id?: string, all?: boolean, entityType?: string, entityId?: string }
//   - { all: true }                      marks every notification for the user as read
//   - { id: "..." }                      marks a single notification as read
//   - { entityType: "request", entityId } marks every unread row pointing at that
//     entity as read. This is what opening a request clears: a bell that only
//     empties when you click each row through the popover is a bell people stop
//     looking at, and the row you just acted on is the one you already read.
export async function PATCH(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; all?: boolean; entityType?: string; entityId?: string }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { entityType, entityId } = body
  const hasEntity = !!entityType && !!entityId
  if (!body.id && !body.all && !hasEntity) {
    return NextResponse.json({ error: 'Provide id, all: true, or entityType + entityId' }, { status: 400 })
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
  } else if (entityType && entityId) {
    // Always scoped to the caller's own rows, so this cannot be used to clear
    // somebody else's bell by guessing an entity id.
    await drizzle
      .update(schema.notifications)
      .set({ read: true })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.entityType, entityType),
          eq(schema.notifications.entityId, entityId),
        )
      )
  }

  return NextResponse.json({ success: true })
}
