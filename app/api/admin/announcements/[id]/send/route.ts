import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { fanOutAnnouncementEmails } from '@/lib/announcement-emails'

// POST /api/admin/announcements/[id]/send
// Publishes a previously-created (draft) announcement and, when the
// announcement was created with email delivery on, fans the email out via the
// shared fan-out (same targeting, React Email template, and per-contact
// notification-preference handling as the create route - the two paths must
// never diverge). Also reachable via the worker MCP send_announcement tool.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const now = new Date().toISOString()

  const rows = await database
    .select()
    .from(schema.announcements)
    .where(eq(schema.announcements.id, id))
    .limit(1)

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
  }

  const announcement = rows[0]

  // Mark as published.
  await database
    .update(schema.announcements)
    .set({ publishedAt: now, updatedAt: now })
    .where(eq(schema.announcements.id, id))

  // Email fan-out (best effort - a delivery failure never fails the publish).
  // Guarded by the announcement's own email flag and by "not already emailed"
  // so re-posting to this endpoint cannot double-send.
  let emailsSent = 0
  if (announcement.sentByEmail && !announcement.emailSentAt) {
    let targetIds: string[] | null = null
    if (announcement.targetIds) {
      try {
        targetIds = JSON.parse(announcement.targetIds) as string[]
      } catch {
        targetIds = null
      }
    }
    try {
      emailsSent = await fanOutAnnouncementEmails(database, {
        title: announcement.title,
        body: announcement.body,
        type: announcement.type,
        targetType: announcement.targetType,
        targetValue: announcement.targetValue,
        targetIds,
      })
    } catch (err) {
      console.error('[announcements] send fan-out failed', err)
    }

    await database
      .update(schema.announcements)
      .set({ emailSentAt: now, updatedAt: now })
      .where(eq(schema.announcements.id, id))
  }

  return NextResponse.json({
    success: true,
    publishedAt: now,
    emailsSent,
  })
}
