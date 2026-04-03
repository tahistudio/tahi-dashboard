import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import {
  calculateCommitmentEndDate,
  CYCLE_BUNDLED_ADDONS,
  CYCLE_MONTHS,
  isValidBillingInterval,
  type BillingInterval,
} from '@/lib/billing'

type Params = { params: Promise<{ id: string }> }

// ── POST /api/admin/subscriptions/[id]/change-cycle ─────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as { newCycle?: string }

  if (!body.newCycle) {
    return NextResponse.json(
      { error: 'newCycle is required' },
      { status: 400 },
    )
  }

  if (!isValidBillingInterval(body.newCycle)) {
    return NextResponse.json(
      { error: 'newCycle must be monthly, quarterly, or annual' },
      { status: 400 },
    )
  }

  const newCycle = body.newCycle as BillingInterval

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

  const oldCycle = (sub.billingInterval ?? 'monthly') as BillingInterval
  const now = new Date().toISOString()

  // Determine if this is an upgrade (longer commitment)
  const isUpgrade = CYCLE_MONTHS[newCycle] > CYCLE_MONTHS[oldCycle]

  // Build the new included add-ons: merge existing custom add-ons with cycle-bundled ones
  let existingAddons: string[] = []
  try {
    existingAddons = JSON.parse(sub.includedAddons ?? '[]') as string[]
  } catch {
    existingAddons = []
  }

  // Remove add-ons that were auto-bundled from the old cycle
  const oldBundled = new Set(CYCLE_BUNDLED_ADDONS[oldCycle])
  const customAddons = existingAddons.filter(a => !oldBundled.has(a))

  // Add new cycle bundled add-ons
  const newBundled = CYCLE_BUNDLED_ADDONS[newCycle]
  const mergedAddons = Array.from(new Set([...customAddons, ...newBundled]))

  const patch: Record<string, unknown> = {
    billingInterval: newCycle,
    includedAddons: JSON.stringify(mergedAddons),
    updatedAt: now,
  }

  // Set commitment period when upgrading to a longer cycle
  if (isUpgrade) {
    patch.currentPeriodStart = now
    patch.currentPeriodEnd = calculateCommitmentEndDate(now, newCycle)
  }

  await drizzle
    .update(schema.subscriptions)
    .set(patch)
    .where(eq(schema.subscriptions.id, id))

  return NextResponse.json({
    success: true,
    billingInterval: newCycle,
    includedAddons: mergedAddons,
    commitmentStartDate: isUpgrade ? now : (sub.currentPeriodStart ?? null),
    commitmentEndDate: isUpgrade
      ? patch.currentPeriodEnd
      : (sub.currentPeriodEnd ?? null),
  })
}
