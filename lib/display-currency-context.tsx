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
  asCurrencyCode,
  BASE_CURRENCY,
  buildRateMap,
  convertFromNzd,
  formatCurrency as formatCurrencyBase,
  formatPinnedBaseAmount,
  resolvePinnedCurrency,
  type CurrencyCode,
  type ExchangeRate,
  type RateMap,
  SUPPORTED_CURRENCIES,
  DISPLAY_CURRENCIES,
} from '@/lib/currency'
import { apiPath } from '@/lib/api'

/**
 * Re-exported for the client components that already read them from here.
 * The definitions themselves live in the server-safe lib/currency.ts, because
 * the dashboard layout is a server component and calls `resolvePinnedCurrency`:
 * a server module importing a value from this file gets a stub that throws.
 */
export { asCurrencyCode, resolvePinnedCurrency }

const STORAGE_KEY = 'tahi-display-currency'
const DEFAULT_CURRENCY: CurrencyCode = 'NZD'

interface DisplayCurrencyContextValue {
  /**
   * The currency this session RUNS in: what `toDisplay` converts into and what
   * `format` labels its output with. A pinned session runs in the NZD base,
   * NOT in the client's billed currency, because every amount those two take
   * is already expressed in the base and a pin is not licence to re-denominate
   * it (see formatPinnedBaseAmount in lib/currency.ts). Read `pinnedCurrency`
   * for the currency the client is actually billed in.
   */
  displayCurrency: CurrencyCode
  /** Change the global display currency. Writes through to localStorage. */
  setDisplayCurrency: (code: CurrencyCode) => void
  /**
   * The currency is fixed and cannot be changed. True for every client-audience
   * session (a real client, or the studio inside Client view).
   * `setDisplayCurrency` is a no-op and the nav switcher does not render: a
   * client's money is theirs, not a preview of ours, and a client re-converting
   * their own invoice into another currency only ever produces a number nobody
   * will bill or pay.
   */
  isPinned: boolean
  /**
   * The currency the pinned client is BILLED in (their invoices, their Stripe
   * charge), or null for a studio session. Deliberately separate from
   * `displayCurrency`: it is a fact about the client, not an instruction to
   * convert base figures into it.
   */
  pinnedCurrency: CurrencyCode | null
  /** Whether exchange rates have been loaded. `false` = using fallback (unconverted). */
  ratesLoaded: boolean
  /** Raw rates array, in case a consumer needs the canonical data. */
  exchangeRates: ExchangeRate[]
  /** Pre-built rate map for aggregation loops. */
  rateMap: RateMap
  /** Convert an amount already expressed in NZD to the current display currency. */
  toDisplay: (amountNzd: number) => number
  /**
   * Format an NZD amount in the current display currency. A pinned session
   * reads it in the base currency, unconverted: the pin says what the client
   * is billed in, not what a base figure is worth. See formatPinnedBaseAmount
   * in lib/currency.ts for why converting is not safe here.
   */
  format: (amountNzd: number) => string
  /** Format a native-currency amount as-is, no conversion. */
  formatNative: (amount: number, currency: string) => string
  /**
   * Native amount as primary, display-currency equivalent as ` (\u2248 $X)` suffix
   * when different. A pinned session gets the native amount alone: one
   * currency per figure on a client surface.
   */
  formatNativeWithDisplay: (amount: number, currency: string) => string
  /** Currency options surfaced in the switcher. Narrower than
   *  SUPPORTED_CURRENCIES \u2014 only the 5 we actually use day-to-day. */
  options: typeof DISPLAY_CURRENCIES
  /** Full list of currencies the system understands, including ones that
   *  don't appear in the nav switcher (CAD, SGD, HKD, JPY, CHF). Useful
   *  for forms that need to record what a client is billed in. */
  allCurrencies: typeof SUPPORTED_CURRENCIES
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
  /**
   * The currency this client is billed in. Fixes the shell and hides the
   * switcher: a client's money is not a preview surface. The dashboard layout
   * resolves it with `resolvePinnedCurrency` for every client-audience session,
   * which refuses to read a schema default as a decision. Null (the studio) is
   * unchanged: stored preference, switcher, conversions.
   */
  pinned?: string | null
}

export function DisplayCurrencyProvider({ children, initial, pinned }: ProviderProps) {
  const pinnedCode = asCurrencyCode(pinned)
  // SSR / first client render uses the default (or passed initial). Once
  // the component mounts we upgrade to the stored preference.
  const [chosenCurrency, setChosenCurrencyState] = useState<CurrencyCode>(
    initial ?? DEFAULT_CURRENCY,
  )
  // A pinned session runs in the BASE currency rather than in the client's
  // billed one. `toDisplay` and `format` both take amounts already expressed in
  // the base, and converting those is what printed "US$882 per month" at a
  // client on a NZ$1,500 plan. Their billed currency is still carried, as
  // `pinnedCurrency`; the amounts that genuinely are native (invoice totals)
  // reach `formatNative` with their own currency and are untouched by this.
  const displayCurrency: CurrencyCode = pinnedCode ? BASE_CURRENCY : chosenCurrency
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([])
  const [ratesLoaded, setRatesLoaded] = useState(false)

  // Hydrate from localStorage after mount. Skipped when pinned: a client's
  // shell is decided by their org, never by a preference this browser may have
  // picked up during an earlier studio session on the same machine.
  useEffect(() => {
    if (pinnedCode) return
    const stored = safeReadStoredCurrency()
    setChosenCurrencyState(prev => (prev === stored ? prev : stored))
  }, [pinnedCode])

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
    // Pinned sessions have no switcher; ignore a programmatic change too so a
    // stray caller cannot re-denominate a client's own money behind their back.
    if (pinnedCode) return
    setChosenCurrencyState(code)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, code)
      } catch {
        // Storage unavailable (private mode / quota) — ignore, preference
        // won't persist but current session still works.
      }
    }
  }, [pinnedCode])

  const rateMap = useMemo<RateMap>(() => buildRateMap(exchangeRates), [exchangeRates])

  const toDisplay = useCallback((amountNzd: number): number => {
    if (displayCurrency === 'NZD') return amountNzd
    if (!ratesLoaded || exchangeRates.length === 0) return amountNzd
    return convertFromNzd(amountNzd, displayCurrency, exchangeRates)
  }, [displayCurrency, exchangeRates, ratesLoaded])

  const formatNative = useCallback((amount: number, currency: string): string => {
    return formatCurrencyBase(amount, currency)
  }, [])

  const formatNativeWithDisplay = useCallback((amount: number, currency: string): string => {
    const native = formatCurrencyBase(amount, currency)
    // One currency per figure on a client surface. A pinned session is a
    // client reading their own money: the billed amount IS the record, and a
    // second figure beside it doubles the width of every table cell and KPI
    // tile for a number nobody will charge. The studio, which is comparing
    // across clients, still gets the equivalence.
    if (pinnedCode) return native
    if (!ratesLoaded || currency === displayCurrency) return native
    // Convert native -> NZD -> display. First re-base into NZD.
    const nzdRow = exchangeRates.find(r => r.currency === 'NZD')
    const fromRow = exchangeRates.find(r => r.currency === currency)
    if (!nzdRow || !fromRow || fromRow.rateToUsd === 0) return native
    const amountNzd = amount / (fromRow.rateToUsd / nzdRow.rateToUsd)
    const displayFormatted = formatCurrencyBase(toDisplay(amountNzd), displayCurrency)
    return `${native} \u2248 ${displayFormatted}`
  }, [displayCurrency, exchangeRates, ratesLoaded, toDisplay, pinnedCode])

  const format = useCallback((amountNzd: number): string => {
    // A pin names the currency the client is BILLED in. It does not make an
    // NZD-base figure a native one, and the base rate of a plan is disputed
    // between lib/billing.ts and lib/stripe-plans.ts, so a pinned client reads
    // the base figure in the base currency. The rule and the shapes it rejects
    // are stated once, in lib/currency.ts.
    if (pinnedCode) return formatPinnedBaseAmount(amountNzd)
    return formatCurrencyBase(toDisplay(amountNzd), displayCurrency)
  }, [toDisplay, displayCurrency, pinnedCode])

  const value = useMemo<DisplayCurrencyContextValue>(() => ({
    displayCurrency,
    setDisplayCurrency,
    isPinned: pinnedCode !== null,
    pinnedCurrency: pinnedCode,
    ratesLoaded,
    exchangeRates,
    rateMap,
    toDisplay,
    format,
    formatNative,
    formatNativeWithDisplay,
    options: DISPLAY_CURRENCIES,
    allCurrencies: SUPPORTED_CURRENCIES,
  }), [displayCurrency, setDisplayCurrency, pinnedCode, ratesLoaded, exchangeRates, rateMap, toDisplay, format, formatNative, formatNativeWithDisplay])

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
    isPinned: false,
    pinnedCurrency: null,
    ratesLoaded: false,
    exchangeRates: [],
    rateMap: { NZD: 1 },
    toDisplay: (n) => n,
    format: (n) => formatCurrencyBase(n, DEFAULT_CURRENCY),
    formatNative: (n, c) => formatCurrencyBase(n, c),
    formatNativeWithDisplay: (n, c) => formatCurrencyBase(n, c),
    options: DISPLAY_CURRENCIES,
    allCurrencies: SUPPORTED_CURRENCIES,
  }
}
