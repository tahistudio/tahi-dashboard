import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionsProvider } from '@/components/tahi/permissions-context'

const state = vi.hoisted(() => ({ loading: false, pending: 2 }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/use-resource', () => ({
  useResource: (key: string | null) => ({
    data: key === '/api/admin/overview' && !state.loading ? {
      kpis: { activeClients: 0, openRequests: 0, inProgress: 0, taskSuggestions: { pending: state.pending, calls: 1 } },
      recentRequests: [], monthlyRevenue: [], cash: null, arAging: null,
      activeTimer: { running: false, label: null }, openByStatus: {}, clientsByPlan: {},
    } : undefined,
    mutate: vi.fn(),
  }),
}))
vi.mock('@/lib/display-currency-context', () => ({
  useDisplayCurrency: () => ({ toDisplay: (amount: number) => amount, format: (amount: number) => `NZD ${amount}`, displayCurrency: 'NZD' }),
}))

import { OwnerHome } from '../owner-home'

function home(tasks?: boolean, requests?: boolean, isSuperAdmin = false) {
  return renderToStaticMarkup(
    <PermissionsProvider value={{ level: isSuperAdmin ? 'super_admin' : 'admin', isAdmin: true, isSuperAdmin, canManagePermissions: false, features: { ...(tasks !== undefined ? { tasks } : {}), ...(requests !== undefined ? { requests } : {}) } }}>
      <OwnerHome ctx={{ audience: 'owner', isReadOnly: false, go: vi.fn(), userName: 'Example' }} />
    </PermissionsProvider>,
  )
}
beforeEach(() => { state.loading = false; state.pending = 2 })

describe('owner home mixed Suggestions card', () => {
  it.each([[false, false], [false, true], [true, false]])('hides the card and count with tasks=%s and requests=%s', (tasks, requests) => {
    const markup = home(tasks, requests)
    expect(markup).not.toContain('Suggestions from calls')
    expect(markup).not.toContain('2 suggestions')
  })
  it('shows the real card when both features are granted', () => {
    const markup = home(true, true)
    expect(markup).toContain('Suggestions from calls')
    expect(markup).toContain('2 suggestions')
  })
  it('does not show a denied loading placeholder', () => {
    state.loading = true
    expect(home(true, false)).not.toContain('Suggestions from calls')
  })
  it('hides the door when permission grants are missing', () => {
    expect(home()).not.toContain('Suggestions from calls')
    expect(home(true)).not.toContain('Suggestions from calls')
  })
  it('preserves the super admin grant', () => {
    expect(home(false, false, true)).toContain('Suggestions from calls')
  })
  it('keeps the permitted empty state quiet', () => {
    state.pending = 0
    expect(home(true, true)).not.toContain('Suggestions from calls')
  })
})
