'use client'

import { useDisplayCurrency } from '@/lib/display-currency-context'
import type { FxFreshness } from '@/lib/fx-freshness'

export function FxFreshnessWarning({ freshness, convertsNative = false }: {
  freshness?: FxFreshness
  convertsNative?: boolean
}) {
  const { displayCurrency, fxFreshness, ratesLoaded } = useDisplayCurrency()
  const warning = freshness?.stale
    ? freshness.warning
    : ratesLoaded && (convertsNative || displayCurrency !== 'NZD') && fxFreshness?.stale
      ? fxFreshness.warning
      : null

  if (!warning) return null

  return (
    <p
      role="status"
      className="text-xs"
      style={{ color: 'var(--badge-warning-text)', margin: '0.75rem 0', lineHeight: 1.5, overflowWrap: 'anywhere' }}
    >
      {warning}
    </p>
  )
}
