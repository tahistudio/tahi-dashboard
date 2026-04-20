/**
 * display-currency-context.tsx — global currency preference.
 *
 * Decision #042 (2026-04-21): one toggle in the nav bar, persisted across
 * sessions, respected by every page that shows money. Replaces the
 * per-page DisplayCurrency state in pipeline-content.tsx and
 * reports-content.tsx.
 *
 * - `displayCurrency` — user's chosen preview currency (NZD/USD/AUD/...).
 * - `exchangeRates` — fetched once per session from /api/admin/exchange-rates.
 * - `toDisplay(nzd)` — converts an amount already in NZD into the display
 *   currency. Totals and anything already stored as `valueNzd` goes through
 *   this.
 * - `format(nzd)` — convenience: `toDisplay` + `formatCurrency` in one call.
 * - `formatNative(amount, currency)` — format a native-currency amount
 *   (e.g. an invoice that was actually billed in GBP). Use this for
 *   anything where you want to preserve the billed currency.
 * - `formatNativeWithDisplay(amount, currency)` — primary native amount +
 *   a ` (\u2248 <display>)` suffix when the currencies differ. Use on
 *   invoice lines, deal values, and anywhere a legal record matters.
 *
 * Persistence: the chosen code lives in `localStorage` under
 * `tahi-display-currency`. First render on the client before hydration
 * will show the default (NZD); the first useEffect swaps to the stored
 * value. This is a one-frame flash by design — we're not putting this
 * preference in a cookie (not worth the SSR complexity).
 */

'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  buildRateMap,
  convertFromNzd,
  formatCurrency as formatCurrencyBase,
  type CurrencyCode,
  type ExchangeRate,
  type RateMap,
  SUPPORTED_CURRENCIES,
} from '@/lib/currency'
import { apiPath } from '@/lib/api'

const STORAGE_KEY = 'tahi-display-currency'
const DEFAULT_CURRENCY: CurrencyCode = 'NZD'

interface DisplayCurrencyContextValue {
  /** Currently selected display currency code. */
  displayCurrency: CurrencyCode
  /** Change the global display currency. Writes through to localStorage. */
  setDisplayCurrency: (code: CurrencyCode) => void
  /** Whether exchange rates have been loaded. `false` = using fallback (unconverted). */
  ratesLoaded: boolean
  /** Raw rates array, in case a consumer needs the canonical data. */
  exchangeRates: ExchangeRate[]
  /** Pre-built rate map for aggregation loops. */
  rateMap: RateMap
  /** Convert an amount already expressed in NZD to the current display currency. */
  toDisplay: (amountNzd: number) => number
  /** Format an NZD amount in the current display currency. */
  format: (amountNzd: number) => string
  /** Format a native-currency amount as-is, no conversion. */
  formatNative: (amount: number, currency: string) => string
  /** Native amount as primary, display-currency equivalent as ` (\u2248 $X)` suffix when different. */
  formatNativeWithDisplay: (amount: number, currency: string) => string
  /** All supported currency options, for dropdowns. */
  options: typeof SUPPORTED_CURRENCIES
}

const DisplayCurrencyContext = createContext<DisplayCurrencyContextValue | null>(null)

function safeReadStoredCurrency(): CurrencyCode {
  if (typeof window === 'undefined') return DEFAULT_CURRENCY
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CURRENCY
    const match = SUPPORTED_CURRENCIES.find(c => c.code === raw)
    return match ? (match.code as CurrencyCode) : DEFAULT_CURRENCY
  } catch {
    return DEFAULT_CURRENCY
  }
}

interface ProviderProps {
  children: React.ReactNode
  /** Override the default NZD if a caller wants a different initial value. */
  initial?: CurrencyCode
}

export function DisplayCurrencyProvider({ children, initial }: ProviderProps) {
  // SSR / first client render uses the default (or passed initial). Once
  // the component mounts we upgrade to the stored preference.
  const [displayCurrency, setDisplayCurrencyState] = useState<CurrencyCode>(initial ?? DEFAULT_CURRENCY)
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([])
  const [ratesLoaded, setRatesLoaded] = useState(false)

  // Hydrate from localStorage after mount.
  useEffect(() => {
    const stored = safeReadStoredCurrency()
    if (stored !== displayCurrency) {
      setDisplayCurrencyState(stored)
    }
    // Intentionally only run on mount; `displayCurrency` in deps would
    // re-read storage every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch exchange rates once per session.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(apiPath('/api/admin/exchange-rates'))
        if (!res.ok) throw new Error('rates fetch failed')
        const data = await res.json() as { rates?: ExchangeRate[] | Record<string, number> }
        if (cancelled) return
        let rates: ExchangeRate[] = []
        if (Array.isArray(data.rates)) {
          rates = data.rates
        } else if (data.rates && typeof data.rates === 'object') {
          // The exchange-rates endpoint returns { rates: Record<code, rate> }.
          // Convert to the array shape buildRateMap expects.
          rates = Object.entries(data.rates).map(([currency, rateToUsd]) => ({
            currency,
            rateToUsd: Number(rateToUsd),
          }))
        }
        setExchangeRates(rates)
        setRatesLoaded(true)
      } catch {
        // Rates unavailable — conversions will fall through as native values.
        setExchangeRates([])
        setRatesLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const setDisplayCurrency = useCallback((code: CurrencyCode) => {
    setDisplayCurrencyState(code)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, code)
      } catch {
        // Storage unavailable (private mode / quota) — ignore, preference
        // won't persist but current session still works.
      }
    }
  }, [])

  const rateMap = useMemo<RateMap>(() => buildRateMap(exchangeRates), [exchangeRates])

  const toDisplay = useCallback((amountNzd: number): number => {
    if (displayCurrency === 'NZD') return amountNzd
    if (!ratesLoaded || exchangeRates.length === 0) return amountNzd
    return convertFromNzd(amountNzd, displayCurrency, exchangeRates)
  }, [displayCurrency, exchangeRates, ratesLoaded])

  const format = useCallback((amountNzd: number): string => {
    return formatCurrencyBase(toDisplay(amountNzd), displayCurrency)
  }, [toDisplay, displayCurrency])

  const formatNative = useCallback((amount: number, currency: string): string => {
    return formatCurrencyBase(amount, currency)
  }, [])

  const formatNativeWithDisplay = useCallback((amount: number, currency: string): string => {
    const native = formatCurrencyBase(amount, currency)
    if (!ratesLoaded || currency === displayCurrency) return native
    // Convert native -> NZD -> display. First re-base into NZD.
    const nzdRow = exchangeRates.find(r => r.currency === 'NZD')
    const fromRow = exchangeRates.find(r => r.currency === currency)
    if (!nzdRow || !fromRow || fromRow.rateToUsd === 0) return native
    const amountNzd = amount / (fromRow.rateToUsd / nzdRow.rateToUsd)
    const displayFormatted = formatCurrencyBase(toDisplay(amountNzd), displayCurrency)
    return `${native} \u2248 ${displayFormatted}`
  }, [displayCurrency, exchangeRates, ratesLoaded, toDisplay])

  const value = useMemo<DisplayCurrencyContextValue>(() => ({
    displayCurrency,
    setDisplayCurrency,
    ratesLoaded,
    exchangeRates,
    rateMap,
    toDisplay,
    format,
    formatNative,
    formatNativeWithDisplay,
    options: SUPPORTED_CURRENCIES,
  }), [displayCurrency, setDisplayCurrency, ratesLoaded, exchangeRates, rateMap, toDisplay, format, formatNative, formatNativeWithDisplay])

  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>
}

/**
 * Read the global display currency and formatters.
 *
 * Safe-by-default: if called outside a provider, returns a stub that
 * formats in NZD and doesn't convert. This means components can be rendered
 * in tests or in isolation without blowing up.
 */
export function useDisplayCurrency(): DisplayCurrencyContextValue {
  const ctx = useContext(DisplayCurrencyContext)
  if (ctx) return ctx
  // Stub fallback — NZD everywhere, no conversion.
  return {
    displayCurrency: DEFAULT_CURRENCY,
    setDisplayCurrency: () => {},
    ratesLoaded: false,
    exchangeRates: [],
    rateMap: { NZD: 1 },
    toDisplay: (n) => n,
    format: (n) => formatCurrencyBase(n, DEFAULT_CURRENCY),
    formatNative: (n, c) => formatCurrencyBase(n, c),
    formatNativeWithDisplay: (n, c) => formatCurrencyBase(n, c),
    options: SUPPORTED_CURRENCIES,
  }
}
