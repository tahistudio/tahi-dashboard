import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const VALID_CADENCES = ['monthly', 'quarterly', 'annual', 'one_off'] as const
type Cadence = typeof VALID_CADENCES[number]
function isCadence(v: unknown): v is Cadence {
  return typeof v === 'string' && (VALID_CADENCES as readonly string[]).includes(v)
}

/**
 * GET /api/admin/commitments
 * Returns all expense commitments, newest first.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const drizzle = (await db()) as D1

  const rows = await drizzle
    .select()
    .from(schema.expenseCommitments)
    .orderBy(desc(schema.expenseCommitments.createdAt))
    .catch(() => [] as Array<typeof schema.expenseCommitments.$inferSelect>)

  return NextResponse.json({ commitments: rows })
}

/**
 * POST /api/admin/commitments
 * Body: { name, amount, currency?, cadence?, category?, vendor?, nextDueDate?, notes?, linkedXeroAccount?, active? }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as Partial<{
    name: string
    amount: number
    currency: string
    cadence: string
    category: string
    vendor: string | null
    nextDueDate: string | null
    startDate: string | null
    endDate: string | null
    billingDayOfMonth: number | null
    notes: string | null
    linkedXeroAccount: string | null
    active: boolean
  }>

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) {
    return NextResponse.json({ error: 'amount must be a finite number' }, { status: 400 })
  }
  const cadence: Cadence = isCadence(body.cadence) ? body.cadence : 'monthly'

  const drizzle = (await db()) as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await drizzle.insert(schema.expenseCommitments).values({
    id,
    name: body.name.trim(),
    vendor: body.vendor ?? null,
    amount: body.amount,
    currency: (body.currency ?? 'NZD').toUpperCase(),
    cadence,
    category: body.category ?? 'other',
    nextDueDate: body.nextDueDate ?? null,
    startDate: body.startDate ?? null,
    endDate: body.endDate ?? null,
    billingDayOfMonth: body.billingDayOfMonth ?? null,
    active: body.active ?? true,
    notes: body.notes ?? null,
    linkedXeroAccount: body.linkedXeroAccount ?? null,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
