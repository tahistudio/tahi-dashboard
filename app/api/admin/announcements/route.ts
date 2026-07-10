import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'
import { fanOutAnnouncementEmails } from '@/lib/announcement-emails'

// ── GET /api/admin/announcements ────────────────────────────────────────────
// List announcements, most recent first.
// Supports ?active=true for only non-expired announcements.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const activeOnly = url.searchParams.get('active') === 'true'

  const database = await db()

  let rows = await database
    .select()
    .from(schema.announcements)
    .orderBy(desc(schema.announcements.createdAt))

  if (activeOnly) {
    const now = new Date().toISOString()
    rows = rows.filter(a => {
      // Not expired
      if (a.expiresAt && a.expiresAt < now) return false
      // Must be published
      if (!a.publishedAt) return false
      return true
    })
  }

  return NextResponse.json({ announcements: rows })
}

// ── POST /api/admin/announcements ───────────────────────────────────────────
// Create a new announcement.
// Body: { title, content, type?, targetType, targetValue?, targetIds?,
//         expiresAt?, emoji?, ctaLabel?, ctaUrl?, publish?, sendEmail? }
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    title?: string
    content?: string
    type?: string
    targetType?: string
    targetValue?: string | null
    targetIds?: string[] | null
    expiresAt?: string | null
    emoji?: string | null
    ctaLabel?: string | null
    ctaUrl?: string | null
    publish?: boolean
    sendEmail?: boolean
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  const targetType = body.targetType ?? 'all'
  if (!['all', 'plan_type', 'org'].includes(targetType)) {
    return NextResponse.json(
      { error: 'targetType must be one of: all, plan_type, org' },
      { status: 400 }
    )
  }

  const targetValue = body.targetValue ?? null
  const targetIds = body.targetIds ?? null

  // An org-targeted announcement nobody can see is a publish that lies.
  if (targetType === 'org' && (!Array.isArray(targetIds) || targetIds.length === 0)) {
    return NextResponse.json(
      { error: 'targetIds must include at least one organisation when targetType is org' },
      { status: 400 }
    )
  }

  const database = await db()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const title = body.title.trim()
  const content = body.content.trim()
  const type = body.type ?? 'info'
  // Emoji can span several UTF-16 units (ZWJ sequences, variation selectors),
  // so the cap is generous while still rejecting pasted paragraphs.
  const emoji = body.emoji?.trim().slice(0, 16) || null
  const ctaLabel = body.ctaLabel?.trim() || null
  const ctaUrl = body.ctaUrl?.trim() || null
  const sendEmail = body.sendEmail === true

  await database.insert(schema.announcements).values({
    id,
    title,
    body: content,
    type,
    targetType,
    targetValue,
    targetIds: targetIds ? JSON.stringify(targetIds) : null,
    expiresAt: body.expiresAt ?? null,
    publishedAt: body.publish ? now : null,
    emoji,
    ctaLabel,
    ctaUrl,
    // Recorded so the [id]/send route can honour the email request when a
    // draft is published later (guarded there by emailSentAt).
    sentByEmail: sendEmail ? 1 : 0,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  // Optional email fan-out. Only send when the announcement is actually
  // published (a draft stays silent) and email delivery was requested. Best
  // effort: any failure here is swallowed so the announcement still succeeds.
  let emailed = 0
  if (sendEmail && body.publish === true) {
    try {
      emailed = await fanOutAnnouncementEmails(database, {
        title,
        body: content,
        type,
        targetType,
        targetValue,
        targetIds,
      })
    } catch (err) {
      console.error('[announcements] email fan-out failed', err)
    }
    // Mark the attempt so [id]/send can never double-deliver this one.
    await database
      .update(schema.announcements)
      .set({ emailSentAt: now, updatedAt: now })
      .where(eq(schema.announcements.id, id))
  }

  return NextResponse.json({ id, emailed }, { status: 201 })
}
