import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc } from 'drizzle-orm'

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
// Body: { title, content, type?, targetType, targetValue?, targetIds?, expiresAt? }
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
    targetValue?: string
    targetIds?: string[]
    expiresAt?: string
    publish?: boolean
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

  const database = await db()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.announcements).values({
    id,
    title: body.title.trim(),
    body: body.content.trim(),
    type: body.type ?? 'info',
    targetType,
    targetValue: body.targetValue ?? null,
    targetIds: body.targetIds ? JSON.stringify(body.targetIds) : null,
    expiresAt: body.expiresAt ?? null,
    publishedAt: body.publish ? now : null,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
