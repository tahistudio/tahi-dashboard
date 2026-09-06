/**
 * Currency conversion utilities.
 * Base currency: NZD (per Decision #028)
 * Exchange rates stored as rate_to_usd in the exchangeRates table.
 *
 * Conversion formula: amountNZD = amount / rateForCurrency * rateForNZD
 */

export const SUPPORTED_CURRENCIES = [
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  { code: 'USD', symbol: 'US$', name: 'US Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
] as const

/**
 * Currencies surfaced in the nav-bar switcher + New Deal dialog + any other
 * "pick a currency for me" UI. Kept intentionally short so the dropdown is
 * scannable. `SUPPORTED_CURRENCIES` (above) stays at 10 entries so invoices
 * billed in, say, JPY still render with the right symbol + decimals.
 */
export const DISPLAY_CURRENCIES = SUPPORTED_CURRENCIES.filter(c =>
  ['NZD', 'USD', 'AUD', 'GBP', 'EUR'].includes(c.code),
)

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]['code']

/**
 * The currency every NZD-base amount in the app is already expressed in (plan
 * rates, catalogue prices, `valueNzd` totals). Separate from the display
 * PREFERENCE on purpose: that one is a choice, this one is a fact about the
 * data, and only one of them may change.
 */
export const BASE_CURRENCY: CurrencyCode = 'NZD'

/** Narrow a raw code (D1 `organisations.preferred_currency`) to a known one. */
export function asCurrencyCode(raw: string | null | undefined): CurrencyCode | null {
  if (!raw) return null
  const match = SUPPORTED_CURRENCIES.find(c => c.code === raw.trim().toUpperCase())
  return match ? (match.code as CurrencyCode) : null
}

/**
 * The value `organisations.preferred_currency` carries when NOBODY CHOSE IT.
 *
 * `drizzle/migrations/0000_equal_mojo.sql` declares the column
 * `text DEFAULT 'USD'`, and the New client dialog's route
 * (POST /api/admin/clients) used to omit it, so SQLite wrote 'USD' for every
 * client the studio ever created. A row holding this value is therefore
 * evidence of nothing, and reading it as "this client is billed in US
 * dollars" is how a NZ client comes to read their own money in a currency
 * nobody charges them.
 *
 * That route now writes a currency explicitly, so rows created from here on
 * DO mean it. Until the existing rows are backfilled the two cases are
 * indistinguishable, so the pin below insists on corroboration.
 */
export const UNCHOSEN_PREFERRED_CURRENCY: CurrencyCode = 'USD'

/**
 * What the app actually knows about the currency a client is billed in.
 *
 * Every field is a column whose stored value may be a schema DEFAULT rather
 * than a decision somebody made, which is the whole reason this is an object
 * and not one string.
 */
export interface PinnedCurrencyEvidence {
  /**
   * `organisations.preferred_currency`. Defaults to 'USD' (see
   * UNCHOSEN_PREFERRED_CURRENCY), so a bare 'USD' is not a choice; any other
   * code had to be written by hand.
   */
  preferredCurrency?: string | null
  /**
   * `organisations.custom_mrr_currency`, the currency the studio recorded this
   * client's MRR in. Its own default is the NZD base, so a NON-base value here
   * is a decision taken in the client's Money card, and it is what corroborates
   * a 'USD' sitting in preferred_currency. Same precedence the studio's own
   * reads already use (app/(dashboard)/clients/[id]/_kit/account-card.tsx).
   */
  customMrrCurrency?: string | null
}

/**
 * Which currency the dashboard shell should pin, given the audience and what
 * the org's rows actually say. Pure so the rule is testable without a render.
 *
 * - Studio session: null. Stored preference, nav switcher, conversions, all
 *   unchanged.
 * - Client audience (a real client, or the studio inside Client view): the
 *   currency they are billed in, but ONLY where that is a decision rather than
 *   a column default. Everything else falls back to the NZD base.
 *
 * The fallback is the point. `preferred_currency` defaults to 'USD' while every
 * other read in the codebase falls back to 'NZD' (`org.preferredCurrency ??
 * 'NZD'`), so trusting a bare 'USD' would hand roughly every existing client a
 * US$ shell over money recorded in NZD. An unreadable or missing row is the
 * same case: pin the base rather than leave a client's money floating on
 * whatever this browser last chose.
 *
 * This lives here, in a server-safe module, and NOT in
 * lib/display-currency-context.tsx: the dashboard layout is a server component
 * and calls it, and a server module may never import a value from a
 * 'use client' file. Next replaces every export of such a file with a stub
 * that throws when called, which is what took production down on 2026-09-06.
 */
export function resolvePinnedCurrency(
  evidence: PinnedCurrencyEvidence,
  isClientAudience: boolean,
): CurrencyCode | null {
  if (!isClientAudience) return null

  // A non-base custom_mrr_currency is the strongest signal we hold: that column
  // defaults to the base, so anything else was typed into the Money card.
  const mrr = asCurrencyCode(evidence.customMrrCurrency)
  if (mrr && mrr !== BASE_CURRENCY) return mrr

  const preferred = asCurrencyCode(evidence.preferredCurrency)
  if (!preferred) return BASE_CURRENCY
  // Any code other than the schema default had to be written deliberately.
  if (preferred !== UNCHOSEN_PREFERRED_CURRENCY) return preferred
  // A bare 'USD' cannot be told apart from an untouched default, so it counts
  // only where the MRR currency says the same thing. (Unreachable today given
  // the branch above, and stated anyway so the rule survives a reordering.)
  return mrr === UNCHOSEN_PREFERRED_CURRENCY ? preferred : BASE_CURRENCY
}

export interface ExchangeRate {
  currency: string
  rateToUsd: number
}

export type RateMap = Record<string, number>

/**
 * Build a pre-computed rate map keyed by currency code. Values are
 * "how many of [currency] per 1 NZD", used as a divisor to convert
 * TO NZD. NZD itself is 1.
 *
 * Note: rateToUsd in the DB is stored as "how many of [currency] per
 * 1 USD". We re-base against NZD here so the downstream math is a
 * single division per amount.
 *
 *   map[C] = rateToUsd[C] / rateToUsd[NZD]
 *   amountInNzd = amountInC / map[C]
 */
export function buildRateMap(rates: ExchangeRate[]): RateMap {
  const nzdRow = rates.find(r => r.currency === 'NZD')
  if (!nzdRow) {
    console.warn('[currency] No NZD rate in exchange_rates — conversions may be incorrect')
  }
  const nzdRateToUsd = nzdRow?.rateToUsd ?? 1
  const map: RateMap = { NZD: 1 }
  for (const r of rates) {
    map[r.currency] = r.rateToUsd / nzdRateToUsd
  }
  return map
}

/**
 * Pure-math conversion using a pre-built rate map. Prefer this in hot
 * aggregation loops over convertToNzd (which searches the rates array
 * each call).
 */
export function toNzd(amount: number, currency: string, rateMap: RateMap): number {
  if (!Number.isFinite(amount)) return 0
  if (currency === 'NZD') return amount
  const rate = rateMap[currency]
  if (!rate || rate === 0) return amount // unknown currency — fall back unconverted
  return amount / rate
}

/**
 * Sum a list of native-currency amounts, converting each to NZD first.
 */
export function sumAsNzd<T>(
  rows: T[],
  pick: (row: T) => { amount: number; currency: string },
  rateMap: RateMap,
): number {
  let total = 0
  for (const row of rows) {
    const { amount, currency } = pick(row)
    total += toNzd(amount, currency, rateMap)
  }
  return total
}

/**
 * Convert an amount from one currency to NZD using the raw rates array.
 * Convenience wrapper for one-off conversions. For aggregation loops,
 * use buildRateMap + toNzd instead.
 */
export function convertToNzd(
  amount: number,
  fromCurrency: string,
  rates: ExchangeRate[],
): number {
  if (fromCurrency === 'NZD') return amount

  const fromRate = rates.find(r => r.currency === fromCurrency)?.rateToUsd
  const nzdRate = rates.find(r => r.currency === 'NZD')?.rateToUsd

  if (!fromRate || !nzdRate) return amount // Can't convert, return as-is

  return (amount / fromRate) * nzdRate
}

/**
 * Convert an amount from NZD to another currency.
 */
export function convertFromNzd(
  amountNzd: number,
  toCurrency: string,
  rates: ExchangeRate[],
): number {
  if (toCurrency === 'NZD') return amountNzd

  const toRate = rates.find(r => r.currency === toCurrency)?.rateToUsd
  const nzdRate = rates.find(r => r.currency === 'NZD')?.rateToUsd

  if (!toRate || !nzdRate) return amountNzd

  return (amountNzd / nzdRate) * toRate
}

/**
 * Format a currency amount for display.
 *
 * Decision #045 (2026-04-21): defaults to whole dollars \u2014 cents are noise
 * on KPIs and cramped on mobile. Pass `{ decimals: 2 }` explicitly when you
 * need precision (invoice line items that aren't a round number, per-unit
 * prices, etc.). JPY is always whole-unit because the currency has no sub-
 * denomination.
 */
export interface FormatCurrencyOptions {
  /** Force a specific decimal precision. Default: 0 (whole units). */
  decimals?: number
}

export function formatCurrency(
  amount: number,
  currency: string = 'NZD',
  options: FormatCurrencyOptions = {},
): string {
  const info = SUPPORTED_CURRENCIES.find(c => c.code === currency)
  const symbol = info?.symbol ?? currency

  // JPY has no decimal places regardless of caller preference.
  const decimals = currency === 'JPY' ? 0 : (options.decimals ?? 0)

  const formatted = amount.toLocaleString('en-NZ', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return `${symbol}${formatted}`
}

/**
 * Format with currency code suffix for clarity in multi-currency contexts.
 */
export function formatCurrencyWithCode(
  amount: number,
  currency: string = 'NZD',
  options: FormatCurrencyOptions = {},
): string {
  return `${formatCurrency(amount, currency, options)} ${currency}`
}

/**
 * How a PINNED session renders an amount that is stored in the NZD base.
 *
 * It does NOT convert it, and that is the whole rule.
 *
 * A pin names the currency a client is BILLED in. It does not turn an NZD-base
 * figure (a plan rate, a catalogue price, a total) into a native one, and this
 * codebase does not currently agree with itself about what those base figures
 * are worth:
 *
 *   lib/billing.ts       PLAN_MONTHLY_RATES, "Monthly base rates in NZD",
 *                        maintain 1500
 *   lib/stripe-plans.ts  STRIPE_CURRENCY 'usd', maintain baseAmount 150000,
 *                        charged as US$1,500
 *
 * The same plan is 1500 in two different currencies depending on which file
 * you read. A client billed on the Stripe side pays US$1,500 while an FX
 * conversion of the NZD figure prints roughly US$882 at them, so converting
 * cannot be right for both, and getting it wrong states a price nobody charges
 * on a screen whose next row is a real invoice. Until the two are reconciled a
 * base figure is shown in the base currency, exactly as it is recorded, and
 * only genuinely native amounts (invoice totals, through `formatNative`) wear
 * the client's own symbol.
 *
 * The shapes this rules out, and why:
 *  - `US$882`. A converted figure with no marker, read as the price.
 *  - `≈ US$882`. Honest about being approximate, still derived from a base
 *    whose currency the codebase disputes.
 *  - `NZ$1,500 ≈ US$882`. Two currencies in one figure: roughly doubles the
 *    width of every KPI tile, table cell and plan card, and 375px has no room.
 */
export function formatPinnedBaseAmount(
  amountNzd: number,
  options: FormatCurrencyOptions = {},
): string {
  return formatCurrency(amountNzd, BASE_CURRENCY, options)
}
