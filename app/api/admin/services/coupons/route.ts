import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, like } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const COUPON_PREFIX = 'coupon_'

interface CouponData {
  code: string
  discountPercent: number
  maxUses: number | null
  usedCount: number
  expiresAt: string | null
  createdAt: string
}

function parseCouponValue(value: string | null): CouponData | null {
  if (!value) return null
  try {
    return JSON.parse(value) as CouponData
  } catch {
    return null
  }
}

// GET /api/admin/services/coupons - list all coupons
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const rows = await database
    .select()
    .from(schema.settings)
    .where(like(schema.settings.key, `${COUPON_PREFIX}%`))

  const items: CouponData[] = []
  for (const row of rows) {
    const data = parseCouponValue(row.value)
    if (data) items.push(data)
  }

  return NextResponse.json({ items })
}

// POST /api/admin/services/coupons - create a coupon
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as {
    code?: string
    discountPercent?: number
    maxUses?: number | null
    expiresAt?: string | null
  }

  if (!body.code?.trim()) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 })
  }

  const code = body.code.trim().toUpperCase()

  if (!body.discountPercent || body.discountPercent <= 0 || body.discountPercent > 100) {
    return NextResponse.json({ error: 'discountPercent must be between 1 and 100' }, { status: 400 })
  }

  const database = await db()
  const key = `${COUPON_PREFIX}${code}`

  // Check if coupon already exists
  const existing = await database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1)

  if (existing.length > 0) {
    return NextResponse.json({ error: 'A coupon with this code already exists' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const couponData: CouponData = {
    code,
    discountPercent: body.discountPercent,
    maxUses: body.maxUses ?? null,
    usedCount: 0,
    expiresAt: body.expiresAt ?? null,
    createdAt: now,
  }

  await database.insert(schema.settings).values({
    key,
    value: JSON.stringify(couponData),
    updatedAt: now,
  })

  return NextResponse.json({ success: true, code }, { status: 201 })
}

// DELETE /api/admin/services/coupons - delete a coupon
export async function DELETE(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.json({ error: 'code query param is required' }, { status: 400 })
  }

  const database = await db()
  const key = `${COUPON_PREFIX}${code.toUpperCase()}`

  await database
    .delete(schema.settings)
    .where(eq(schema.settings.key, key))

  return NextResponse.json({ success: true })
}
