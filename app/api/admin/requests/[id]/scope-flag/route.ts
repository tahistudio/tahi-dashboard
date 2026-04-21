/**
 * /api/admin/requests/[id]/scope-flag
 *
 *   POST   → flag as scope creep. Body: { reason?: string }
 *   DELETE → unflag (clears scopeFlagged + scopeFlagReason).
 *
 * Admin only. Access-scoped to the request's org. Updates updatedAt so
 * the scope-flag change shows on the activity log.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null) as { reason?: string } | null

  const database = await db()
  const drizzle = database as Drizzle

  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  await drizzle
    .update(schema.requests)
    .set({
      scopeFlagged: true,
      scopeFlagReason: body?.reason?.trim() || null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.requests.id, id))

  return NextResponse.json({ ok: true, scopeFlagged: true, reason: body?.reason ?? null })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db()
  const drizzle = database as Drizzle

  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  await drizzle
    .update(schema.requests)
    .set({
      scopeFlagged: false,
      scopeFlagReason: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.requests.id, id))

  return NextResponse.json({ ok: true, scopeFlagged: false })
}
