import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import {
  calculateBundledSavings,
  calculateCommitmentEndDate,
  calculateGst,
  CYCLE_BUNDLED_ADDONS,
  CYCLE_MONTHS,
  isValidBillingInterval,
  PLAN_MONTHLY_RATES,
  type BillingInterval,
} from '@/lib/billing'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/subscriptions/[id] ───────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [sub] = await drizzle
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, id))
    .limit(1)

  if (!sub) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
  }

  // Get org name
  const [org] = await drizzle
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, sub.orgId))
    .limit(1)

  const interval = (sub.billingInterval ?? 'monthly') as BillingInterval
  const monthlyRate = PLAN_MONTHLY_RATES[sub.planType] ?? 0
  const cycleMonths = CYCLE_MONTHS[interval]
  const cycleTotal = monthlyRate * cycleMonths
  const monthlySavings = calculateBundledSavings(interval)
  const cycleSavings = monthlySavings * cycleMonths

  let parsedAddons: string[] = []
  try {
    parsedAddons = JSON.parse(sub.includedAddons ?? '[]') as string[]
  } catch {
    parsedAddons = []
  }

  const gst = calculateGst(cycleTotal, sub.billingCountry ?? null)

  return NextResponse.json({
    subscription: {
      ...sub,
      includedAddons: parsedAddons,
    },
    orgName: org?.name ?? 'Unknown',
    billing: {
      interval,
      monthlyRate,
      cycleMonths,
      cycleTotal,
      monthlySavings,
      cycleSavings,
      gst,
    },
  })
}

// ── PUT /api/admin/subscriptions/[id] ───────────────────────────────────────
export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    billingInterval?: string
    includedAddons?: string[]
    discountPercent?: number | null
    billingCountry?: string | null
  }

  // Validate billing interval if provided
  if (body.billingInterval !== undefined) {
    if (!isValidBillingInterval(body.billingInterval)) {
      return NextResponse.json(
        { error: 'billingInterval must be monthly, quarterly, or annual' },
        { status: 400 },
      )
    }
  }

  // Validate discount percent if provided
  if (body.discountPercent !== undefined && body.discountPercent !== null) {
    if (typeof body.discountPercent !== 'number' || body.discountPercent < 0 || body.discountPercent > 100) {
      return NextResponse.json(
        { error: 'discountPercent must be a number between 0 and 100' },
        { status: 400 },
      )
    }
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify subscription exists
  const [existing] = await drizzle
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }

  if (body.billingInterval !== undefined) {
    patch.billingInterval = body.billingInterval

    // Auto-add bundled add-ons based on new cycle
    const cycleBundled = CYCLE_BUNDLED_ADDONS[body.billingInterval as BillingInterval]
    const currentAddons = body.includedAddons ?? []
    const merged = Array.from(new Set([...currentAddons, ...cycleBundled]))
    patch.includedAddons = JSON.stringify(merged)
  } else if (body.includedAddons !== undefined) {
    patch.includedAddons = JSON.stringify(body.includedAddons)
  }

  if (body.discountPercent !== undefined) {
    patch.discountPercent = body.discountPercent
  }
  if (body.billingCountry !== undefined) {
    patch.billingCountry = body.billingCountry
  }

  await drizzle
    .update(schema.subscriptions)
    .set(patch)
    .where(eq(schema.subscriptions.id, id))

  return NextResponse.json({ success: true })
}
