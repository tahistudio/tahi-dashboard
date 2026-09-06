import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/d1'
import { requireAccessToOrg } from '@/lib/require-access'
import { logAudit } from '@/lib/audit'
import { NO_PLAN } from '@/lib/plan-type'
import {
  calculateBundledSavings,
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
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'billing')
  if (featureDenied) return featureDenied

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
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'billing')
  if (featureDenied) return featureDenied

  const { id } = await params
  const body = await req.json() as {
    billingInterval?: string
    includedAddons?: string[]
    discountPercent?: number | null
    billingCountry?: string | null
    hasPrioritySupport?: boolean
    hasSeoAddon?: boolean
    planType?: string
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
  // Add-on toggles + plan-type changes (admin-only fields the client never sees)
  if (typeof body.hasPrioritySupport === 'boolean') {
    patch.hasPrioritySupport = body.hasPrioritySupport
  }
  if (typeof body.hasSeoAddon === 'boolean') {
    patch.hasSeoAddon = body.hasSeoAddon
  }
  if (typeof body.planType === 'string' && body.planType.length > 0) {
    patch.planType = body.planType
  }

  await drizzle
    .update(schema.subscriptions)
    .set(patch)
    .where(eq(schema.subscriptions.id, id))

  return NextResponse.json({ success: true })
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

// ── DELETE /api/admin/subscriptions/[id] ────────────────────────────────────
// Removes a plan the client never really had: a subscription minted at client
// creation or deal conversion that nothing was ever billed against. This is
// not cancellation. Cancelling (PUT status) keeps the row for the books; this
// deletes it, together with its tracks, and leaves the client on no plan when
// no other active subscription remains.
//
// Two refusals, each with its reason in one sentence: an invoice that
// references the subscription (invoices.subscription_id) means it was billed,
// so cancel it instead; a request sitting on one of its tracks (either the
// track's current request or any request whose track_id points at it) would be
// orphaned, so move the work off first.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'billing')
  if (featureDenied) return featureDenied

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [sub] = await drizzle
    .select({
      id: schema.subscriptions.id,
      orgId: schema.subscriptions.orgId,
      planType: schema.subscriptions.planType,
      status: schema.subscriptions.status,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, id))
    .limit(1)

  if (!sub) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
  }

  // The verdict on the org comes before any verdict on its contents, so a
  // scoped team member learns nothing about a client they cannot see.
  const denied = await requireAccessToOrg(drizzle, userId, sub.orgId)
  if (denied) return denied

  const [invoiceRefs, trackRows] = await Promise.all([
    drizzle
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.subscriptionId, id)),
    drizzle
      .select({ id: schema.tracks.id, currentRequestId: schema.tracks.currentRequestId })
      .from(schema.tracks)
      .where(eq(schema.tracks.subscriptionId, id)),
  ])

  if (invoiceRefs.length > 0) {
    const n = invoiceRefs.length
    return NextResponse.json({
      error: `Cannot remove this plan: ${count(n, 'invoice')} ${n === 1 ? 'references' : 'reference'} it. Cancel the subscription instead so the invoices keep their plan.`,
    }, { status: 409 })
  }

  const trackIds = trackRows.map(t => t.id)
  const holding = new Set<string>()
  for (const t of trackRows) {
    if (t.currentRequestId) holding.add(t.currentRequestId)
  }
  if (trackIds.length > 0) {
    const onTracks = await drizzle
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(inArray(schema.requests.trackId, trackIds))
    for (const r of onTracks) holding.add(r.id)
  }

  if (holding.size > 0) {
    const n = holding.size
    return NextResponse.json({
      error: `Cannot remove this plan: ${count(n, 'request')} ${n === 1 ? 'sits' : 'sit'} on its tracks. Move them off the tracks first.`,
    }, { status: 409 })
  }

  // Tracks first, explicitly: the FK cascade would do it, but the row count
  // is reported and audited, and D1 environments differ on foreign_keys.
  if (trackIds.length > 0) {
    await drizzle.delete(schema.tracks).where(eq(schema.tracks.subscriptionId, id))
  }
  await drizzle.delete(schema.subscriptions).where(eq(schema.subscriptions.id, id))

  const remaining = await drizzle
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(and(
      eq(schema.subscriptions.orgId, sub.orgId),
      eq(schema.subscriptions.status, 'active'),
    ))
    .limit(1)

  const planCleared = remaining.length === 0
  if (planCleared) {
    await drizzle
      .update(schema.organisations)
      .set({ planType: NO_PLAN, updatedAt: new Date().toISOString() })
      .where(eq(schema.organisations.id, sub.orgId))
  }

  await logAudit(database as DB, {
    action: 'subscription.removed',
    userId,
    entityType: 'subscription',
    entityId: id,
    metadata: {
      orgId: sub.orgId,
      planType: sub.planType,
      status: sub.status,
      tracksRemoved: trackIds.length,
      planCleared,
    },
  })

  return NextResponse.json({ success: true, tracksRemoved: trackIds.length, planCleared })
}
