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

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]['code']

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
 */
export function formatCurrency(
  amount: number,
  currency: string = 'NZD',
): string {
  const info = SUPPORTED_CURRENCIES.find(c => c.code === currency)
  const symbol = info?.symbol ?? currency

  // JPY has no decimal places
  const decimals = currency === 'JPY' ? 0 : 2

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
): string {
  return `${formatCurrency(amount, currency)} ${currency}`
}
