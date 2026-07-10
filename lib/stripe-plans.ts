import Stripe from 'stripe'
import { stripeSecretKey } from '@/lib/stripe-key'

/**
 * Tahi retainer plans + the parallel-track ("Priority Support") add-on, as
 * Stripe recurring prices. The base plan and the add-on are separate
 * subscription items so a client can toggle the add-on without changing plan.
 *
 * Prices are looked up by stable `lookup_key`, so the same code resolves the
 * right price in test and live without hardcoding price IDs. Run the setup
 * route (POST /api/admin/integrations/stripe/setup-plans) once per Stripe
 * environment to create the products + prices; it is idempotent.
 *
 * Amounts are in the smallest currency unit (cents). Mirrors the plan copy in
 * components/tahi/onboarding-content.tsx.
 */

// Matches the existing Tahi Stripe account, which operates in USD. USD is the
// base/settlement currency; clients can pay in a presentment currency below.
export const STRIPE_CURRENCY = 'usd'

/**
 * Presentment currencies a client can choose at checkout. USD is the base; the
 * others are attached to each price as Stripe `currency_options`, so the inline
 * PaymentElement charges in the chosen currency (no hosted Checkout needed).
 *
 * The amounts are an FX snapshot (open.er-api.com, USD base) derived from the
 * USD price via `presentmentAmount()`. They are static once written to Stripe;
 * re-run setup-plans to refresh when rates drift. (True per-customer live
 * conversion would require Stripe Adaptive Pricing, which is Checkout-only.)
 */
export const PRESENTMENT_CURRENCIES = ['usd', 'nzd', 'aud', 'gbp', 'eur', 'cad'] as const
export type PresentmentCurrency = (typeof PRESENTMENT_CURRENCIES)[number]

// FX snapshot, USD base (captured 2026-06-28).
export const FX_USD: Record<PresentmentCurrency, number> = {
  usd: 1,
  nzd: 1.772247,
  aud: 1.449609,
  gbp: 0.757313,
  eur: 0.877826,
  cad: 1.418887,
}

export function isPresentmentCurrency(v: string): v is PresentmentCurrency {
  return (PRESENTMENT_CURRENCIES as readonly string[]).includes(v)
}

/** Convert a USD minor-unit amount to another currency's minor units, rounded
 *  to a whole major unit (no cents) for clean pricing. */
export function presentmentAmount(usdMinor: number, currency: PresentmentCurrency): number {
  if (currency === 'usd') return usdMinor
  const major = Math.round((usdMinor / 100) * FX_USD[currency])
  return major * 100
}

/** The `currency_options` map for a USD base price, for every non-USD currency. */
export function currencyOptionsFor(usdMinor: number): Record<string, { unit_amount: number }> {
  const out: Record<string, { unit_amount: number }> = {}
  for (const c of PRESENTMENT_CURRENCIES) {
    if (c === 'usd') continue
    out[c] = { unit_amount: presentmentAmount(usdMinor, c) }
  }
  return out
}

export type PlanId = 'maintain' | 'scale'

export interface PlanConfig {
  id: PlanId
  name: string
  /** Base retainer price. */
  baseLookup: string
  baseAmount: number
  /** Parallel-track add-on price (priced per plan). */
  trackLookup: string
  trackAmount: number
}

export const STRIPE_PLANS: Record<PlanId, PlanConfig> = {
  maintain: {
    id: 'maintain',
    name: 'Maintain',
    baseLookup: 'tahi_maintain_base',
    baseAmount: 150000, // $1,500
    trackLookup: 'tahi_maintain_track',
    trackAmount: 100000, // $1,000
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    baseLookup: 'tahi_scale_base',
    baseAmount: 400000, // $4,000
    trackLookup: 'tahi_scale_track',
    trackAmount: 150000, // $1,500
  },
}

export function isPlanId(v: string): v is PlanId {
  return v === 'maintain' || v === 'scale'
}

/** All lookup keys, for bulk price resolution. */
export function allLookupKeys(): string[] {
  return Object.values(STRIPE_PLANS).flatMap(p => [p.baseLookup, p.trackLookup])
}

let _stripe: Stripe | null = null
/** Shared Stripe client, or null when STRIPE_SECRET_KEY is not configured. */
export function getStripe(): Stripe | null {
  const key = stripeSecretKey()
  if (!key) return null
  if (!_stripe) {
    _stripe = new Stripe(key, {
      apiVersion: '2025-02-24.acacia',
    })
  }
  return _stripe
}
