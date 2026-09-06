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
 * Which currency the dashboard shell should pin, given the audience and the
 * org's stored preference. Pure so the rule is testable without a render.
 *
 * - Studio session: null. Stored preference, nav switcher, conversions, all
 *   unchanged.
 * - Client audience (a real client, or the studio inside Client view): their
 *   billed currency, falling back to the NZD base rather than to "unpinned".
 *   The fallback matters: `organisations.preferred_currency` defaults to 'USD'
 *   in the schema while every other read in the codebase falls back to 'NZD'
 *   (`org.preferredCurrency ?? 'NZD'`), and an unreadable or missing row must
 *   not leave a client's money floating on whatever this browser last chose.
 *
 * This lives here, in a server-safe module, and NOT in
 * lib/display-currency-context.tsx: the dashboard layout is a server component
 * and calls it, and a server module may never import a value from a
 * 'use client' file. Next replaces every export of such a file with a stub
 * that throws when called, which is what took production down on 2026-09-06.
 */
export function resolvePinnedCurrency(
  preferred: string | null | undefined,
  isClientAudience: boolean,
): CurrencyCode | null {
  if (!isClientAudience) return null
  return asCurrencyCode(preferred) ?? BASE_CURRENCY
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
 * U+2248 ALMOST EQUAL TO, then U+00A0 NO-BREAK SPACE, so a converted figure
 * can never wrap away from the marker that says it is an approximation. The
 * second character is a hard space, not a plain one: check before editing.
 */
export const APPROX_MARKER = '≈ '

/**
 * How a PINNED session renders an amount that is stored in the NZD base.
 *
 * A pin names the currency a client is billed in. It does not turn an NZD-base
 * figure (a plan rate, a catalogue price, a total) into a native one, so the
 * client reads it converted into their own currency behind an approximate
 * marker, and alone: `≈ US$882`.
 *
 * The two shapes this rejects, and why:
 *  - `US$882` bare. States a price nobody charges as though it were the price,
 *    on the same portal as an invoice row actually billed in US$.
 *  - `NZ$1,500 ≈ US$882`. Two currencies in one figure. Roughly doubles the
 *    width of every KPI tile, table cell and plan card on a client surface,
 *    and 375px has no room for it.
 *
 * With no usable rate the conversion would be the identity, so the exact base
 * figure is printed instead: the same number wearing the client's symbol would
 * be a straight lie rather than an approximation.
 */
export function formatPinnedBaseAmount(
  amountNzd: number,
  pinned: CurrencyCode,
  rates: ExchangeRate[],
  ratesLoaded: boolean,
  options: FormatCurrencyOptions = {},
): string {
  if (pinned === BASE_CURRENCY) return formatCurrency(amountNzd, BASE_CURRENCY, options)
  const rated = ratesLoaded
    && rates.some(r => r.currency === BASE_CURRENCY)
    && rates.some(r => r.currency === pinned)
  if (!rated) return formatCurrency(amountNzd, BASE_CURRENCY, options)
  const converted = convertFromNzd(amountNzd, pinned, rates)
  return `${APPROX_MARKER}${formatCurrency(converted, pinned, options)}`
}
