import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// ── PATCH /api/admin/announcements/[id] ─────────────────────────────────────
// Edit an announcement. Any subset of fields may be sent; omitted keys are
// left untouched, explicit nulls clear nullable columns. `publish: true`
// stamps publishedAt (first publish only), `publish: false` unpublishes.
// No email fan-out here - that stays with POST /announcements and
// POST /announcements/[id]/send so the two delivery paths never diverge.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()

  const rows = await database
    .select()
    .from(schema.announcements)
    .where(eq(schema.announcements.id, id))
    .limit(1)
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
  }
  const existing = rows[0]

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
  }

  const now = new Date().toISOString()
  const update: Partial<typeof schema.announcements.$inferInsert> = { updatedAt: now }

  if (body.title !== undefined) {
    if (!body.title.trim()) {
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
    }
    update.title = body.title.trim()
  }
  if (body.content !== undefined) {
    if (!body.content.trim()) {
      return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 })
    }
    update.body = body.content.trim()
  }
  if (body.type !== undefined) update.type = body.type

  if (body.targetType !== undefined) {
    if (!['all', 'plan_type', 'org'].includes(body.targetType)) {
      return NextResponse.json(
        { error: 'targetType must be one of: all, plan_type, org' },
        { status: 400 }
      )
    }
    update.targetType = body.targetType
  }
  if (body.targetValue !== undefined) update.targetValue = body.targetValue ?? null
  if (body.targetIds !== undefined) {
    update.targetIds = body.targetIds && body.targetIds.length
      ? JSON.stringify(body.targetIds)
      : null
  }

  // Validate the resulting targeting, mixing incoming and existing values.
  const finalTargetType = update.targetType ?? existing.targetType
  if (finalTargetType === 'org') {
    const finalTargetIds =
      update.targetIds !== undefined ? update.targetIds : existing.targetIds
    let count = 0
    if (finalTargetIds) {
      try {
        const parsed: unknown = JSON.parse(finalTargetIds)
        count = Array.isArray(parsed) ? parsed.length : 0
      } catch {
        count = 0
      }
    }
    if (count === 0) {
      return NextResponse.json(
        { error: 'targetIds must include at least one organisation when targetType is org' },
        { status: 400 }
      )
    }
  }

  if (body.expiresAt !== undefined) update.expiresAt = body.expiresAt ?? null
  if (body.emoji !== undefined) update.emoji = body.emoji?.trim().slice(0, 16) || null
  if (body.ctaLabel !== undefined) update.ctaLabel = body.ctaLabel?.trim() || null
  if (body.ctaUrl !== undefined) update.ctaUrl = body.ctaUrl?.trim() || null

  if (body.publish !== undefined) {
    update.publishedAt = body.publish ? (existing.publishedAt ?? now) : null
  }

  await database
    .update(schema.announcements)
    .set(update)
    .where(eq(schema.announcements.id, id))

  const [announcement] = await database
    .select()
    .from(schema.announcements)
    .where(eq(schema.announcements.id, id))
    .limit(1)

  return NextResponse.json({ announcement })
}

// ── DELETE /api/admin/announcements/[id] ────────────────────────────────────
// Remove an announcement and its dismissal records.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()

  const rows = await database
    .select({ id: schema.announcements.id })
    .from(schema.announcements)
    .where(eq(schema.announcements.id, id))
    .limit(1)
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
  }

  // Explicit dismissal cleanup: D1 does not always enforce FK cascades.
  await database
    .delete(schema.announcementDismissals)
    .where(eq(schema.announcementDismissals.announcementId, id))
  await database
    .delete(schema.announcements)
    .where(eq(schema.announcements.id, id))

  return NextResponse.json({ ok: true })
}
