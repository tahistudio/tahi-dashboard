/**
 * Currency conversion utilities.
 * Base currency: NZD (per Decision #028)
 * Exchange rates stored as rate_to_usd in the exchangeRates table.
 *
 * Conversion formula: amountNZD = amount / rateForCurrency * rateForNZD
 */

export const SUPPORTED_CURRENCIES = [
  { code: 'NZD', symbol: '$', name: 'New Zealand Dollar' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
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

interface ExchangeRate {
  currency: string
  rateToUsd: number
}

/**
 * Convert an amount from one currency to NZD.
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
