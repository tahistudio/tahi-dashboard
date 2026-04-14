import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string; costId: string }> }
type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const VALID_CATEGORIES = ['contractor', 'software', 'hours', 'other'] as const
type CostCategory = typeof VALID_CATEGORIES[number]

function isCategory(v: unknown): v is CostCategory {
  return typeof v === 'string' && (VALID_CATEGORIES as readonly string[]).includes(v)
}

// PATCH /api/admin/clients/[id]/costs/[costId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId: authOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, costId } = await params
  const body = await req.json() as Partial<{
    description: string
    amount: number
    currency: string
    category: string
    date: string
    recurring: boolean
  }>

  const drizzle = (await db()) as D1

  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.description !== undefined) patch.description = body.description
  if (body.amount !== undefined) patch.amount = body.amount
  if (body.currency !== undefined) patch.currency = body.currency.toUpperCase()
  if (body.category !== undefined && isCategory(body.category)) patch.category = body.category
  if (body.date !== undefined) patch.date = body.date
  if (body.recurring !== undefined) patch.recurring = body.recurring

  await drizzle
    .update(schema.clientCosts)
    .set(patch)
    .where(and(eq(schema.clientCosts.id, costId), eq(schema.clientCosts.orgId, id)))

  return NextResponse.json({ success: true })
}

// DELETE /api/admin/clients/[id]/costs/[costId]
export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId: authOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, costId } = await params
  const drizzle = (await db()) as D1

  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  await drizzle
    .delete(schema.clientCosts)
    .where(and(eq(schema.clientCosts.id, costId), eq(schema.clientCosts.orgId, id)))

  return NextResponse.json({ success: true })
}
