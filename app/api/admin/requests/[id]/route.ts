import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/requests/[id] ─────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await auth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [request] = await drizzle
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      orgName: schema.organisations.name,
      type: schema.requests.type,
      category: schema.requests.category,
      title: schema.requests.title,
      description: schema.requests.description,
      status: schema.requests.status,
      priority: schema.requests.priority,
      assigneeId: schema.requests.assigneeId,
      assigneeName: schema.teamMembers.name,
      estimatedHours: schema.requests.estimatedHours,
      revisionCount: schema.requests.revisionCount,
      maxRevisions: schema.requests.maxRevisions,
      scopeFlagged: schema.requests.scopeFlagged,
      isInternal: schema.requests.isInternal,
      tags: schema.requests.tags,
      createdAt: schema.requests.createdAt,
      updatedAt: schema.requests.updatedAt,
      deliveredAt: schema.requests.deliveredAt,
    })
    .from(schema.requests)
    .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
    .leftJoin(schema.teamMembers, eq(schema.requests.assigneeId, schema.teamMembers.id))
    .where(eq(schema.requests.id, id))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ request })
}

// ── PATCH /api/admin/requests/[id] ───────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId } = await auth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    status?: string
    priority?: string
    assigneeId?: string | null
    estimatedHours?: number | null
    scopeFlagged?: boolean
    trackId?: string | null
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }

  if (body.status !== undefined) {
    patch.status = body.status
    if (body.status === 'delivered') patch.deliveredAt = now
  }
  if (body.priority !== undefined) patch.priority = body.priority
  if ('assigneeId' in body) patch.assigneeId = body.assigneeId ?? null
  if ('estimatedHours' in body) patch.estimatedHours = body.estimatedHours ?? null
  if (body.scopeFlagged !== undefined) patch.scopeFlagged = body.scopeFlagged
  if ('trackId' in body) patch.trackId = body.trackId ?? null

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle
    .update(schema.requests)
    .set(patch)
    .where(eq(schema.requests.id, id))

  // If moving to in_progress, increment revision count if coming back from client_review
  // (handled client-side for now — the status change message is enough)

  return NextResponse.json({ ok: true })
}

// ── DELETE /api/admin/requests/[id] ──────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId } = await auth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Soft-delete: archive rather than destroy
  await drizzle
    .update(schema.requests)
    .set({ status: 'archived', updatedAt: new Date().toISOString() })
    .where(and(eq(schema.requests.id, id)))

  return NextResponse.json({ ok: true })
}
