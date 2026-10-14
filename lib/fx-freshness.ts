const DAY_MS = 86_400_000
const MAX_AGE_MS = 7 * DAY_MS

export interface FxFreshness {
  updatedAt: string | null
  ageDays: number | null
  stale: boolean
  warning: string | null
}

interface DatedRate {
  currency: string
  updatedAt?: string | null
}

/** The oldest rate bounds a conversion's freshness, including its NZD base. */
export function fxFreshness(rates: readonly DatedRate[], now = new Date()): FxFreshness {
  const timestamps = rates.map(rate => Date.parse(rate.updatedAt ?? ''))
  const known = rates.some(rate => rate.currency === 'NZD')
    && timestamps.every(timestamp => Number.isFinite(timestamp) && timestamp <= now.getTime())
  if (!known) {
    return {
      updatedAt: null, ageDays: null, stale: true,
      warning: 'Exchange rate freshness is unknown. Converted cash figures may be out of date. Refresh exchange rates.',
    }
  }
  const oldest = Math.min(...timestamps)
  const ageDays = Math.floor((now.getTime() - oldest) / DAY_MS)
  const stale = now.getTime() - oldest > MAX_AGE_MS
  return {
    updatedAt: new Date(oldest).toISOString(), ageDays, stale,
    warning: stale
      ? `Exchange rates were last refreshed ${ageDays} days ago. Converted cash figures may be out of date. Refresh exchange rates.`
      : null,
  }
}

