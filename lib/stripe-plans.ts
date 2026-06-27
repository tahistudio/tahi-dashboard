import Stripe from 'stripe'

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

export const STRIPE_CURRENCY = 'nzd'

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
  if (!process.env.STRIPE_SECRET_KEY) return null
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    })
  }
  return _stripe
}
