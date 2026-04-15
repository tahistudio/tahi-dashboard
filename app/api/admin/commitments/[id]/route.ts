import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }
type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const VALID_CADENCES = ['monthly', 'quarterly', 'annual', 'one_off'] as const

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json() as Partial<{
    name: string
    amount: number
    currency: string
    cadence: string
    category: string
    vendor: string | null
    nextDueDate: string | null
    notes: string | null
    linkedXeroAccount: string | null
    active: boolean
  }>

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.name !== undefined) patch.name = body.name
  if (body.amount !== undefined) patch.amount = body.amount
  if (body.currency !== undefined) patch.currency = body.currency.toUpperCase()
  if (body.cadence !== undefined && VALID_CADENCES.includes(body.cadence as typeof VALID_CADENCES[number])) patch.cadence = body.cadence
  if (body.category !== undefined) patch.category = body.category
  if ('vendor' in body) patch.vendor = body.vendor ?? null
  if ('nextDueDate' in body) patch.nextDueDate = body.nextDueDate ?? null
  if ('notes' in body) patch.notes = body.notes ?? null
  if ('linkedXeroAccount' in body) patch.linkedXeroAccount = body.linkedXeroAccount ?? null
  if (body.active !== undefined) patch.active = body.active

  const drizzle = (await db()) as D1
  await drizzle.update(schema.expenseCommitments).set(patch).where(eq(schema.expenseCommitments.id, id))

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const drizzle = (await db()) as D1
  await drizzle.delete(schema.expenseCommitments).where(eq(schema.expenseCommitments.id, id))

  return NextResponse.json({ success: true })
}
