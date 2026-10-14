import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FxFreshness } from '@/lib/fx-freshness'

const context = vi.hoisted(() => ({
  displayCurrency: 'NZD' as 'NZD' | 'USD',
  ratesLoaded: true,
  fxFreshness: { updatedAt: '2026-10-14T00:00:00.000Z', ageDays: 0, stale: false, warning: null } as FxFreshness,
}))

vi.mock('@/lib/display-currency-context', () => ({ useDisplayCurrency: () => context }))

import { FxFreshnessWarning } from './fx-freshness-warning'

function stale(warning: string): FxFreshness {
  return { updatedAt: '2026-08-10T00:00:00.000Z', ageDays: 65, stale: true, warning }
}

beforeEach(() => {
  context.displayCurrency = 'NZD'
  context.ratesLoaded = true
  context.fxFreshness = { updatedAt: '2026-10-14T00:00:00.000Z', ageDays: 0, stale: false, warning: null }
})

describe('converted cash freshness warning', () => {
  it('shows stale server conversion rates while client rates are loading', () => {
    context.ratesLoaded = false
    const markup = renderToStaticMarkup(<FxFreshnessWarning freshness={stale('Server cash uses stale exchange rates.')} />)
    expect(markup).toContain('Server cash uses stale exchange rates.')
    expect(markup).toContain('role="status"')
  })

  it('warns when display currency conversion still uses stale client rates after a fresh server read', () => {
    context.displayCurrency = 'USD'
    context.fxFreshness = stale('Display conversion uses stale exchange rates.')
    const markup = renderToStaticMarkup(<FxFreshnessWarning freshness={{ ...context.fxFreshness, stale: false, warning: null }} />)
    expect(markup).toContain('Display conversion uses stale exchange rates.')
  })

  it('warns about stale client rates for native bank balances converted into NZD', () => {
    context.fxFreshness = stale('Native cash conversion uses stale exchange rates.')
    expect(renderToStaticMarkup(<FxFreshnessWarning convertsNative />))
      .toContain('Native cash conversion uses stale exchange rates.')
  })

  it('omits a client warning when NZD amounts do not require conversion', () => {
    context.fxFreshness = stale('Stale client rates.')
    expect(renderToStaticMarkup(<FxFreshnessWarning />)).toBe('')
  })

  it('does not warn about unavailable client rates before they finish loading', () => {
    context.displayCurrency = 'USD'
    context.ratesLoaded = false
    context.fxFreshness = { updatedAt: null, ageDays: null, stale: true, warning: 'Exchange rate freshness is unknown.' }
    expect(renderToStaticMarkup(<FxFreshnessWarning convertsNative />)).toBe('')
  })

  it('shows the server warning first when both conversion sources are stale', () => {
    context.displayCurrency = 'USD'
    context.fxFreshness = stale('Stale client rates.')
    const markup = renderToStaticMarkup(<FxFreshnessWarning freshness={stale('Stale server rates.')} />)
    expect(markup).toContain('Stale server rates.')
    expect(markup).not.toContain('Stale client rates.')
  })

  it('omits the warning when both native and display conversions use fresh rates', () => {
    context.displayCurrency = 'USD'
    expect(renderToStaticMarkup(<FxFreshnessWarning freshness={context.fxFreshness} convertsNative />)).toBe('')
  })
})
