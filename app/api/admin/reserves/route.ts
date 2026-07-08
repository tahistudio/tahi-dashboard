/**
 * /api/admin/reserves — list + create cash reserve pots.
 *
 * Reserves are buckets of cash Liam wants ringfenced so the disposable
 * cash math on /financial-reports stays honest:
 *   - tax: typically NZ corp tax (~28%) accrued daily from revenue
 *   - buffer: hand-set "rainy day" pot
 *   - deposits: client deposits held against future delivery
 *   - other: anything else
 *
 * `accrualRate` lets the daily cron auto-add (today's revenue × rate)
 * to `accruedAmount`. Leave null for fully manual pots.
 *
 * Auth: admin only.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const VALID_CATEGORIES = ['tax', 'buffer', 'deposits', 'other'] as const
type Category = typeof VALID_CATEGORIES[number]
function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (VALID_CATEGORIES as readonly string[]).includes(v)
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'financial_reports')
  if (denied) return denied

  const database = (await db()) as D1
  const rows = await database
    .select()
    .from(schema.reserves)
    .where(eq(schema.reserves.active, true))
    .orderBy(desc(schema.reserves.createdAt))
    .catch(() => [] as Array<typeof schema.reserves.$inferSelect>)

  return NextResponse.json({ reserves: rows })
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'financial_reports')
  if (denied) return denied

  const body = (await req.json()) as Partial<{
    name: string
    category: string
    currency: string
    targetAmount: number | null
    accruedAmount: number
    accrualRate: number | null
    notes: string | null
  }>

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const category: Category = isCategory(body.category) ? body.category : 'other'

  const database = (await db()) as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.reserves).values({
    id,
    name: body.name.trim(),
    category,
    currency: (body.currency ?? 'NZD').toUpperCase(),
    targetAmount: body.targetAmount ?? null,
    accruedAmount: body.accruedAmount ?? 0,
    accrualRate: body.accrualRate ?? null,
    notes: body.notes ?? null,
    active: true,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
