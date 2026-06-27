import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, STRIPE_PLANS, STRIPE_CURRENCY, allLookupKeys, type PlanConfig } from '@/lib/stripe-plans'

export const dynamic = 'force-dynamic'

/**
 * Idempotently create the Stripe products + recurring prices for the Tahi
 * plans and the parallel-track add-on. Safe to run repeatedly and in both test
 * and live (run once per Stripe environment with that environment's keys).
 *
 * GET  -> report which lookup keys already resolve to a price.
 * POST -> ensure every product + price exists; returns the resolved price IDs.
 */

async function findPriceByLookup(stripe: Stripe, lookupKey: string): Promise<Stripe.Price | null> {
  const res = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  return res.data[0] ?? null
}

async function ensureProduct(stripe: Stripe, key: string, name: string): Promise<Stripe.Product> {
  // Reuse a product tagged with our key; create it if missing.
  const search = await stripe.products.search({ query: `metadata['tahi_key']:'${key}'`, limit: 1 })
  if (search.data[0]) return search.data[0]
  return stripe.products.create({ name, metadata: { tahi_key: key } })
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  lookupKey: string,
  amount: number,
): Promise<{ lookupKey: string; priceId: string; created: boolean }> {
  const existing = await findPriceByLookup(stripe, lookupKey)
  if (existing) return { lookupKey, priceId: existing.id, created: false }
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: STRIPE_CURRENCY,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    metadata: { tahi_lookup: lookupKey },
  })
  return { lookupKey, priceId: price.id, created: true }
}

async function ensurePlan(stripe: Stripe, plan: PlanConfig) {
  const baseProduct = await ensureProduct(stripe, `plan_${plan.id}`, `Tahi ${plan.name}`)
  const trackProduct = await ensureProduct(stripe, `track_${plan.id}`, `Tahi ${plan.name} parallel track`)
  const base = await ensurePrice(stripe, baseProduct.id, plan.baseLookup, plan.baseAmount)
  const track = await ensurePrice(stripe, trackProduct.id, plan.trackLookup, plan.trackAmount)
  return { plan: plan.id, base, track }
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 503 })

  const results = []
  for (const plan of Object.values(STRIPE_PLANS)) {
    results.push(await ensurePlan(stripe, plan))
  }
  return NextResponse.json({ success: true, currency: STRIPE_CURRENCY, results })
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ configured: false, error: 'STRIPE_SECRET_KEY not configured' }, { status: 503 })

  const status: Record<string, string | null> = {}
  for (const key of allLookupKeys()) {
    const price = await findPriceByLookup(stripe, key)
    status[key] = price?.id ?? null
  }
  return NextResponse.json({ configured: true, currency: STRIPE_CURRENCY, prices: status })
}
