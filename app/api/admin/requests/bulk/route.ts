import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// ── POST /api/admin/requests/bulk ──────────────────────────────────────────
// Create one request per org.
// Body: { orgIds: string[], title, category?, type?, description?, isInternal? }
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    orgIds?: string[]
    title?: string
    category?: string
    type?: string
    description?: string
    isInternal?: boolean
  }

  if (!body.orgIds || body.orgIds.length === 0) {
    return NextResponse.json({ error: 'orgIds is required and must not be empty' }, { status: 400 })
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const database = await db()
  const now = new Date().toISOString()
  const ids: string[] = []

  for (const targetOrgId of body.orgIds) {
    const id = crypto.randomUUID()
    ids.push(id)

    await database.insert(schema.requests).values({
      id,
      orgId: targetOrgId,
      title: body.title.trim(),
      category: body.category ?? null,
      type: body.type ?? 'small_task',
      description: body.description ?? null,
      status: 'submitted',
      priority: 'standard',
      isInternal: body.isInternal ?? false,
      submittedById: userId,
      submittedByType: 'team_member',
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({ created: ids.length, ids }, { status: 201 })
}

// ── PATCH /api/admin/requests/bulk ─────────────────────────────────────────
// Bulk update requests. Apply the same changes to multiple request IDs.
// Body: { ids: string[], status?, assigneeId?, archived? }
export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    ids?: string[]
    status?: string
    assigneeId?: string | null
    archived?: boolean
  }

  if (!body.ids || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids is required and must not be empty' }, { status: 400 })
  }

  const database = await db()
  const now = new Date().toISOString()
  let updated = 0

  for (const id of body.ids) {
    const updates: Record<string, unknown> = { updatedAt: now }

    if (body.status) {
      updates.status = body.status
      if (body.status === 'delivered') {
        updates.deliveredAt = now
      }
    }
    if (body.assigneeId !== undefined) {
      updates.assigneeId = body.assigneeId
    }
    if (body.archived === true) {
      updates.status = 'archived'
    }

    await database
      .update(schema.requests)
      .set(updates)
      .where(eq(schema.requests.id, id))

    updated++
  }

  return NextResponse.json({ updated })
}
