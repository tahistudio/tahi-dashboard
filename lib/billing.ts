// ─── Billing helpers for subscription tiers ──────────────────────────────────

export interface GstResult {
  subtotal: number
  gst: number
  total: number
}

/**
 * Calculate GST for a given amount and country.
 * GST (15%) is charged ONLY when country === 'NZ'.
 * No VAT or tax for any other country.
 */
export function calculateGst(amount: number, country: string | null): GstResult {
  const gstRate = country === 'NZ' ? 0.15 : 0
  const gst = Math.round(amount * gstRate * 100) / 100
  return {
    subtotal: amount,
    gst,
    total: Math.round((amount + gst) * 100) / 100,
  }
}

// ─── Billing cycle constants ─────────────────────────────────────────────────

export type BillingInterval = 'monthly' | 'quarterly' | 'annual'

export const VALID_BILLING_INTERVALS: BillingInterval[] = ['monthly', 'quarterly', 'annual']

/** Monthly base rates in NZD */
export const PLAN_MONTHLY_RATES: Record<string, number> = {
  maintain: 1500,
  scale: 4000,
}

/** Commitment lengths in months */
export const CYCLE_MONTHS: Record<BillingInterval, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
}

/** Add-ons that are auto-included per billing cycle */
export const CYCLE_BUNDLED_ADDONS: Record<BillingInterval, string[]> = {
  monthly: [],
  quarterly: ['seo_dashboard'],
  annual: ['seo_dashboard', 'extra_track', 'priority_support'],
}

/** Estimated monthly value of each add-on in NZD */
export const ADDON_VALUES: Record<string, number> = {
  seo_dashboard: 150,
  extra_track: 500,
  priority_support: 350,
}

/**
 * Calculate the monthly savings value from bundled add-ons for a billing cycle.
 */
export function calculateBundledSavings(interval: BillingInterval): number {
  const addons = CYCLE_BUNDLED_ADDONS[interval]
  return addons.reduce((sum, addon) => sum + (ADDON_VALUES[addon] ?? 0), 0)
}

/**
 * Given a commitment start date and billing interval, calculate the commitment end date.
 */
export function calculateCommitmentEndDate(
  startDate: string,
  interval: BillingInterval,
): string {
  const d = new Date(startDate)
  d.setMonth(d.getMonth() + CYCLE_MONTHS[interval])
  return d.toISOString()
}

export function isValidBillingInterval(value: string): value is BillingInterval {
  return VALID_BILLING_INTERVALS.includes(value as BillingInterval)
}
