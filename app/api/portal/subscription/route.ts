import { getPortalAuth } from '@/lib/server-auth'
import { isOrgAdmin } from '@/lib/portal-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc, sql } from 'drizzle-orm'
import {
  calculateBundledSavings,
  calculateGst,
  ADDON_VALUES,
  CYCLE_MONTHS,
  PLAN_MONTHLY_RATES,
  type BillingInterval,
} from '@/lib/billing'
import { getPlanLabel, resolveTracksConfig } from '@/lib/plan-utils'
import { loadPlanCatalog } from '@/lib/plan-catalog'
import { INVOICE_CHANNEL_SETTING_KEY, resolveInvoiceChannel } from '@/lib/invoice-channel'
import { projectNextInvoiceDate } from '@/lib/next-invoice-date'

// ── GET /api/portal/subscription ────────────────────────────────────────────
// Returns the client's active subscription with billing tier details, plus
// the shared retainer catalogue (settings K/V `plan_catalog`, admin-edited in
// Settings > Client plans, with lib/billing fallbacks) so the Plan & billing
// tab renders exactly what the studio sells.
export async function GET(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)

  // Deny if not authenticated or if this is the Tahi admin org
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Financial data (plan rates, cycle totals, GST): workspace admins of the
  // org only. Impersonation (admin Client view) has no contact row, so it is
  // allowed through for this read.
  if (!impersonating && !(await isOrgAdmin(drizzle, orgId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
    // No active retainer -> this is a project-type client. The home uses
    // clientType to pick ProjectBoard vs TrackBoard (and to read /api/portal/project).
    return NextResponse.json({ subscription: null, plans, clientType: 'project' })
  }

  // What this client actually pays, not what the studio lists. Two reads of
  // the same org row, because they live in two different places:
  //   1. Typed Drizzle for the columns that ARE in db/schema.ts.
  //   2. Raw SQL for custom_mrr / custom_mrr_currency, which deliberately are
  //      NOT in the Drizzle schema (see the comment in app/api/admin/clients/
  //      [id]/route.ts: keeping them out stops SELECT * crashing on an
  //      environment where migration 0016 has not run). Both are wrapped so a
  //      pre-migration environment falls back to the catalogue rate instead of
  //      500ing, exactly as app/api/portal/capacity/route.ts does.
  let org:
    | {
        preferredCurrency: string | null
        stripeCustomerId: string | null
        tracksMode: string | null
        customSmallTracks: number | null
        customLargeTracks: number | null
        invoiceChannel: string | null
      }
    | undefined
  try {
    ;[org] = await drizzle
      .select({
        preferredCurrency: schema.organisations.preferredCurrency,
        stripeCustomerId: schema.organisations.stripeCustomerId,
        tracksMode: schema.organisations.tracksMode,
        customSmallTracks: schema.organisations.customSmallTracks,
        customLargeTracks: schema.organisations.customLargeTracks,
        invoiceChannel: schema.organisations.invoiceChannel,
      })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1)
  } catch {
    org = undefined
  }

  // Which rail this client is actually billed on, so the "Next invoice"
  // fallback can name it ("Invoiced monthly through Xero") instead of
  // printing TBC when there is no currentPeriodEnd to show. Failure here
  // (settings table missing) falls back to the hardcoded studio default, the
  // same as every other reader of this setting.
  let studioDefaultChannel: string | null = null
  try {
    const [row] = await drizzle
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, INVOICE_CHANNEL_SETTING_KEY))
      .limit(1)
    studioDefaultChannel = row?.value ?? null
  } catch {
    studioDefaultChannel = null
  }
  const invoiceChannel = resolveInvoiceChannel(org?.invoiceChannel ?? null, studioDefaultChannel)

  let customMrr: number | null = null
  let customMrrCurrency: string | null = null
  try {
    const rows = await drizzle.all<{ custom_mrr: number | null; custom_mrr_currency: string | null }>(
      sql`SELECT custom_mrr, custom_mrr_currency FROM organisations WHERE id = ${orgId} LIMIT 1`
    )
    if (rows?.[0]) {
      customMrr = rows[0].custom_mrr
      customMrrCurrency = rows[0].custom_mrr_currency
    }
  } catch {
    // Columns do not exist yet (pre-migration-0016). Fall back to the
    // catalogue rate below rather than failing the whole plan read.
    customMrr = null
    customMrrCurrency = null
  }

  const interval = (sub.billingInterval ?? 'monthly') as BillingInterval
  const catalogPlan = catalog.find((p) => p.id === sub.planType)
  // A negotiated rate wins over the list price, and it carries its own
  // currency: converting it would invent a number this client never agreed to.
  const negotiatedRate = typeof customMrr === 'number' && customMrr > 0 ? customMrr : null
  const customRate = negotiatedRate !== null
  const monthlyRate = negotiatedRate ?? (catalogPlan?.monthlyRate ?? PLAN_MONTHLY_RATES[sub.planType] ?? 0)
  const currency = customRate ? (customMrrCurrency ?? org?.preferredCurrency ?? 'NZD') : 'NZD'
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

  // How much capacity the retainer is ENTITLED to, which is not the same as
  // how many rows happen to exist in the tracks table: a custom 1 small + 1
  // large client with only one physical row was being told they had one track.
  // 'off' mode keeps the real rows, mirroring app/api/portal/capacity.
  const trackRows = await drizzle
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .where(eq(schema.tracks.subscriptionId, sub.id))
  const tracksConfig = resolveTracksConfig(org, sub.planType, !!sub.hasPrioritySupport)
  const trackCount = tracksConfig.mode === 'off'
    ? trackRows.length
    : tracksConfig.smallTracks + tracksConfig.largeTracks

  // The real date wins when Stripe (or an admin edit) has set it. Otherwise,
  // a known period start plus a known cadence still projects an actual
  // expected date rather than admitting nothing at all: a Xero-rail client
  // whose retainer started 3 months ago on a monthly cadence has a next
  // invoice date, it is just never written back to currentPeriodEnd. Only
  // when neither is known does the caller fall back to naming the rail.
  const nextInvoiceDate =
    sub.currentPeriodEnd ?? projectNextInvoiceDate(sub.currentPeriodStart, interval)

  return NextResponse.json({
    // Active retainer -> TrackBoard / "Your plan". The overview home reads this
    // signal (present subscription => retainer) to branch the client home.
    clientType: 'retainer',
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
      // Convenience mirrors for the overview "Your plan" card. monthlyRate is
      // in `currency`, which is the negotiated currency when customRate is
      // true and NZD otherwise, so consumers must render it with
      // <Money native currency> rather than converting it as if it were NZD.
      // nextInvoiceDate is the current period end when Stripe (or an admin)
      // has set one, else a projection from currentPeriodStart + the billing
      // cadence. Null only when neither is known, in which case the caller
      // falls back to naming the rail (see invoiceChannel below) rather than
      // printing an unexplained TBC.
      nextInvoiceDate,
      // 'stripe' | 'xero': which rail this client is actually billed on,
      // resolved the same way app/api/admin/clients/[id]/route.ts does, so a
      // client with no channel of its own inherits the studio default rather
      // than the UI guessing one.
      invoiceChannel,
      monthlyRate,
      currency,
      customRate,
      // No Stripe customer means the Stripe billing portal has nothing to open,
      // so every "manage payment" affordance stays hidden for a Xero-rail client.
      canManagePayment: !!org?.stripeCustomerId,
      trackCount,
      createdAt: sub.createdAt,
    },
    billing: {
      monthlyRate,
      currency,
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
