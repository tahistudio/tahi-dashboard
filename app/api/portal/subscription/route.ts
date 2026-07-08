import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc } from 'drizzle-orm'
import {
  calculateBundledSavings,
  calculateGst,
  ADDON_VALUES,
  CYCLE_MONTHS,
  PLAN_MONTHLY_RATES,
  type BillingInterval,
} from '@/lib/billing'
import { getPlanLabel } from '@/lib/plan-utils'
import { loadPlanCatalog } from '@/lib/plan-catalog'

// ── GET /api/portal/subscription ────────────────────────────────────────────
// Returns the client's active subscription with billing tier details, plus
// the shared retainer catalogue (settings K/V `plan_catalog`, admin-edited in
// Settings > Client plans, with lib/billing fallbacks) so the Plan & billing
// tab renders exactly what the studio sells.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

  // Deny if not authenticated or if this is the Tahi admin org
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const catalog = await loadPlanCatalog(drizzle)
  const plans = catalog.map((p) => ({
    id: p.id,
    name: p.name,
    tag: p.tag,
    feats: p.feats,
    rec: p.rec,
    monthlyRate: p.monthlyRate,
    trackRate: p.trackRate,
  }))

  const [sub] = await drizzle
    .select()
    .from(schema.subscriptions)
    .where(and(
      eq(schema.subscriptions.orgId, orgId),
      eq(schema.subscriptions.status, 'active'),
    ))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1)

  if (!sub) {
    return NextResponse.json({ subscription: null, plans })
  }

  const interval = (sub.billingInterval ?? 'monthly') as BillingInterval
  const catalogPlan = catalog.find((p) => p.id === sub.planType)
  const monthlyRate = catalogPlan?.monthlyRate ?? PLAN_MONTHLY_RATES[sub.planType] ?? 0
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

  // Build add-on details with value info
  const addonDetails = parsedAddons.map(addon => ({
    key: addon,
    label: addon.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    monthlyValue: ADDON_VALUES[addon] ?? 0,
  }))

  const gst = calculateGst(cycleTotal, sub.billingCountry ?? null)

  // Calculate commitment end date from currentPeriodStart if available
  const commitmentEndDate: string | null = sub.currentPeriodEnd ?? null

  // How many capacity tracks the retainer currently runs (drives the extra
  // tracks stepper on the client Plan & billing tab).
  const trackRows = await drizzle
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .where(eq(schema.tracks.subscriptionId, sub.id))
  const trackCount = trackRows.length

  return NextResponse.json({
    subscription: {
      id: sub.id,
      planType: sub.planType,
      planLabel: catalogPlan?.name ?? getPlanLabel(sub.planType),
      status: sub.status,
      billingInterval: interval,
      includedAddons: parsedAddons,
      addonDetails,
      hasPrioritySupport: !!sub.hasPrioritySupport,
      hasSeoAddon: !!sub.hasSeoAddon,
      currentPeriodStart: sub.currentPeriodStart ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      commitmentEndDate,
      trackCount,
      createdAt: sub.createdAt,
    },
    billing: {
      monthlyRate,
      cycleMonths,
      cycleTotal,
      monthlySavings,
      cycleSavings,
      gst,
      billingCountry: sub.billingCountry ?? null,
    },
    plans,
  })
}
