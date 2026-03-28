import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type RouteParams = { params: Promise<{ id: string }> }

// ── PATCH /api/admin/automations/[id] ────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    name?: string
    triggerEvent?: string
    conditions?: unknown[]
    actions?: unknown[]
    enabled?: boolean
  }

  const database = await db()

  const existing = await database.query.automationRules.findFirst({
    where: eq(schema.automationRules.id, id),
  })

  if (!existing) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }

  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.triggerEvent !== undefined) updates.triggerEvent = body.triggerEvent
  if (body.conditions !== undefined) updates.conditions = JSON.stringify(body.conditions)
  if (body.actions !== undefined) updates.actions = JSON.stringify(body.actions)
  if (body.enabled !== undefined) updates.enabled = body.enabled

  await database
    .update(schema.automationRules)
    .set(updates)
    .where(eq(schema.automationRules.id, id))

  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/automations/[id] ───────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()

  await database
    .delete(schema.automationRules)
    .where(eq(schema.automationRules.id, id))

  return NextResponse.json({ success: true })
}
