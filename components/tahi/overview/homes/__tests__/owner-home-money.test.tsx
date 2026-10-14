import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionsProvider } from '@/components/tahi/permissions-context'

const state = vi.hoisted(() => ({
  delta: 0 as number | null,
  warning: null as string | null,
  calls: [] as string[],
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/tahi/daily-brief-provider', () => ({
  useDailyBrief: () => ({ data: { urgent: [], week: [], slept: [], summary: 'All clear', generatedAt: '2026-10-14T00:00:00.000Z' }, isLoading: false, isRefreshing: false, error: null, refresh: vi.fn() }),
}))
vi.mock('@/lib/use-resource', () => ({
  useResource: (key: string | null) => {
    if (key) state.calls.push(key)
    return {
      data: key === '/api/admin/overview' ? {
        kpis: { activeClients: 0, openRequests: 0, inProgress: 0, mrr: 10000 },
        mrrDeltaPct: state.delta, mrrDeltaBasisMonth: '2026-09',
        recentRequests: [], monthlyRevenue: [{ month: '2026-10', total: 0 }],
        cash: { totalNzd: 20000, burnNzd: 5000, runwayMonths: 4, yieldFreshness: { warning: state.warning } },
        arAging: null, activeTimer: { running: false, label: null }, openByStatus: {}, clientsByPlan: {},
      } : key === '/api/admin/reports/pipeline-forecast' ? {
        byStage: [{ stageId: 'open', name: 'Open', position: 0, probability: 50, dealCount: 151, weightedUpfrontNzd: 10000, weightedMonthlyNzd: 500, isClosedWon: false, isClosedLost: false }],
        closingSplit: { closingThisMonth: 111, pastCloseDate: 40 },
      } : undefined,
      mutate: vi.fn(),
    }
  },
}))
vi.mock('@/lib/display-currency-context', () => ({
  useDisplayCurrency: () => ({ toDisplay: (amount: number) => amount, format: (amount: number) => `NZD ${amount}`, displayCurrency: 'NZD' }),
}))

import { OwnerHome } from '../owner-home'

function home() {
  return renderToStaticMarkup(
    <PermissionsProvider value={{ level: 'super_admin', isAdmin: true, isSuperAdmin: true, canManagePermissions: true, features: {} }}>
      <OwnerHome ctx={{ audience: 'owner', isReadOnly: false, go: vi.fn() }} />
    </PermissionsProvider>,
  )
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T00:00:00.000Z'))
  state.delta = 0
  state.warning = null
  state.calls = []
})
afterEach(() => vi.useRealTimers())

describe('owner home money accuracy', () => {
  it.each([0, -20, 12.5])('shows the stored MRR comparison %s even without paid invoices', delta => {
    state.delta = delta
    const markup = home()
    expect(markup).toContain('vs Sept')
    expect(markup).toContain(`${Math.abs(delta)}%`)
  })
  it('keeps the comparison absent when no stored MRR exists', () => {
    state.delta = null
    expect(home()).not.toContain('vs Sept')
  })
  it('shows the stale yield warning beside cash without changing the figure', () => {
    state.warning = 'Yield holdings are over 30 days old. Cash may be out of date.'
    const markup = home()
    expect(markup).toContain(state.warning)
    expect(markup).toContain('role="status"')
    expect(markup).toContain('in the bank')
  })
  it('reads complete closing counts from the forecast instead of a capped deal list', () => {
    const markup = home()
    expect(markup).toContain('111')
    expect(markup).toContain('40')
    expect(markup).toContain('past its close date')
    expect(state.calls.some(path => path.startsWith('/api/admin/deals'))).toBe(false)
  })
})
