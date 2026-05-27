/**
 * /api/admin/reserves/[id] — update + delete cash reserve pots.
 *
 * Soft delete: setting `active = false` keeps the row for historical
 * accrual records but removes it from the disposable-cash math.
 * Hard DELETE removes entirely (use sparingly).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }
type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const VALID_CATEGORIES = ['tax', 'buffer', 'deposits', 'other'] as const

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await req.json()) as Partial<{
    name: string
    category: string
    currency: string
    targetAmount: number | null
    accruedAmount: number
    accrualRate: number | null
    notes: string | null
    active: boolean
  }>

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.name !== undefined) patch.name = body.name
  if (body.category !== undefined && VALID_CATEGORIES.includes(body.category as typeof VALID_CATEGORIES[number])) patch.category = body.category
  if (body.currency !== undefined) patch.currency = body.currency.toUpperCase()
  if ('targetAmount' in body) patch.targetAmount = body.targetAmount ?? null
  if (body.accruedAmount !== undefined) patch.accruedAmount = body.accruedAmount
  if ('accrualRate' in body) patch.accrualRate = body.accrualRate ?? null
  if ('notes' in body) patch.notes = body.notes ?? null
  if (body.active !== undefined) patch.active = body.active

  const database = (await db()) as D1
  await database.update(schema.reserves).set(patch).where(eq(schema.reserves.id, id))

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = (await db()) as D1
  await database.delete(schema.reserves).where(eq(schema.reserves.id, id))

  return NextResponse.json({ success: true })
}
