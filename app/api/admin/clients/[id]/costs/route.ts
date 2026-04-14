import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const VALID_CATEGORIES = ['contractor', 'software', 'hours', 'other'] as const
type CostCategory = typeof VALID_CATEGORIES[number]

function isCategory(v: unknown): v is CostCategory {
  return typeof v === 'string' && (VALID_CATEGORIES as readonly string[]).includes(v)
}

// GET /api/admin/clients/[id]/costs
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId: authOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const drizzle = (await db()) as D1

  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  const costs = await drizzle
    .select()
    .from(schema.clientCosts)
    .where(eq(schema.clientCosts.orgId, id))
    .orderBy(desc(schema.clientCosts.date))

  return NextResponse.json({ costs })
}

// POST /api/admin/clients/[id]/costs
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId: authOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json() as Partial<{
    description: string
    amount: number
    currency: string
    category: string
    date: string
    recurring: boolean
  }>

  if (!body.description?.trim()) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) {
    return NextResponse.json({ error: 'amount must be a finite number' }, { status: 400 })
  }
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  const category = isCategory(body.category) ? body.category : 'other'

  const drizzle = (await db()) as D1

  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  const now = new Date().toISOString()
  const newId = crypto.randomUUID()

  await drizzle.insert(schema.clientCosts).values({
    id: newId,
    orgId: id,
    description: body.description.trim(),
    amount: body.amount,
    currency: (body.currency ?? 'NZD').toUpperCase(),
    category,
    date: body.date,
    recurring: body.recurring ?? false,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id: newId }, { status: 201 })
}
