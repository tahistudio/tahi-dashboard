import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SWRConfig } from 'swr'
import type { ComponentProps } from 'react'
import { ApiError } from '@/lib/swr-fetcher'
import { PermissionsProvider } from '@/components/tahi/permissions-context'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { useAllInvoices } from '../use-all-invoices'
import { StudioInvoiceList, type InvoiceCreateProps } from '../studio-invoice-list'
import { InvoiceList } from '../../invoice-list'
import { InvoiceMobileRow } from '../invoice-mobile-row'
import { InvoicesBand, InvoiceTotalValue } from '../invoices-band'
import { invoiceMoneyTotal } from '../invoice-views'
import { invoiceAgeLabel, invoiceDueLabel } from '@/lib/invoice-pay-state'
import type { StudioInvoice } from '../invoice-views'

const captured = vi.hoisted(() => ({
  buttons: new Map<string, (event: never) => unknown>(),
  imported: null as (() => void) | null,
  created: null as InvoiceCreateProps['onCreated'] | null,
  push: vi.fn(), mutate: vi.fn(), toast: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: captured.push }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/invoices',
}))
vi.mock('../use-all-invoices', () => ({ useAllInvoices: vi.fn() }))
vi.mock('@/components/tahi/impersonation-banner', () => ({ useImpersonation: vi.fn() }))
vi.mock('@/components/tahi/toast', () => ({ useToast: () => ({ showToast: captured.toast }) }))
vi.mock('@/components/tahi/tahi-button', async original => {
  const actual = await original<typeof import('@/components/tahi/tahi-button')>()
  return { ...actual, TahiButton: (props: ComponentProps<typeof actual.TahiButton>) => {
    if (typeof props.children === 'string' && props.onClick) captured.buttons.set(props.children, props.onClick as (event: never) => unknown)
    return <actual.TahiButton {...props} />
  } }
})
vi.mock('../../stripe-invoice-recovery', async original => {
  const actual = await original<typeof import('../../stripe-invoice-recovery')>()
  return { ...actual, StripeInvoiceRecovery: (props: ComponentProps<typeof actual.StripeInvoiceRecovery>) => {
    captured.imported = props.onImported
    return <actual.StripeInvoiceRecovery {...props} />
  } }
})

const base: StudioInvoice = {
  id: 'inv-1', orgId: 'org-a', orgName: 'Client A', number: 'INV-2026-001', source: 'stripe', status: 'viewed',
  totalAmount: 100, currency: 'USD', dueDate: '2099-10-20', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  stripeHostedInvoiceUrl: 'https://stripe.example/pay', paidAt: null,
}
function CreateInvoice(props: InvoiceCreateProps) { captured.created = props.onCreated; return null }
function ledger(over: Partial<ReturnType<typeof useAllInvoices>> = {}) {
  return { items: [base], loading: false, error: undefined, scopeNone: false, capped: false, complete: true, mutate: captured.mutate, ...over }
}
function render(over: Partial<ReturnType<typeof useAllInvoices>> = {}, superAdmin = false) {
  vi.mocked(useAllInvoices).mockReturnValue(ledger(over))
  return renderToStaticMarkup(<SWRConfig value={{ provider: () => new Map() }}>
    <PermissionsProvider value={{ level: superAdmin ? 'super_admin' : 'team_member', isAdmin: false, isSuperAdmin: superAdmin, canManagePermissions: false, features: { invoices: true } }}>
      <StudioInvoiceList CreateInvoice={CreateInvoice} />
    </PermissionsProvider>
  </SWRConfig>)
}
beforeEach(() => {
  vi.clearAllMocks()
  captured.buttons.clear(); captured.imported = null; captured.created = null
  captured.mutate.mockResolvedValue(undefined)
  vi.mocked(useImpersonation).mockReturnValue({ isImpersonatingClient: false } as ReturnType<typeof useImpersonation>)
})

describe('bounded studio ledger rendering', () => {
  it('renders the rail, four KPIs, reference, native money, Viewed vocabulary and stored pay-page state', () => {
    const html = render()
    expect(html).toContain('Invoice views and filters')
    for (const label of ['Outstanding', 'Overdue', 'Collected in', 'Sitting in drafts', 'Viewed', 'INV-2026-001', 'USD', 'Stripe, link live']) expect(html).toContain(label)
    expect(html).toContain('data-private')
    expect(html).toContain('href="/invoices/inv-1"')
    expect(html).toContain('href="/clients/org-a"')
    expect(html).not.toContain('By client')
    expect(html).not.toContain('Import from Xero')
    expect(html).not.toContain('Mark as paid')
    expect(html).not.toContain('Opened')
  })
  it('keeps the actual recovery component behind its super-admin guard', () => {
    expect(render({}, false)).not.toContain('Recover paid Stripe invoice')
    expect(render({}, true)).toContain('Recover paid Stripe invoice')
  })
  it('marks every desktop and card client/reference link as a row control so DataTable preserves its destination', () => {
    const html = render()
    for (const href of ['/clients/org-a', '/invoices/inv-1']) {
      const links = [...html.matchAll(/<a\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(`href="${href}"`))
      expect(links).toHaveLength(2)
      for (const link of links) expect(link).toContain('data-row-control="true"')
    }
    expect(html).toContain('No payment page')
    expect(html).not.toContain('No way to pay')
  })
  it('retains all seven desktop fields and full values when long identity and money text must wrap', () => {
    const invoice = { ...base, orgName: 'AnUnbrokenClientOrganisationNameWithNoConvenientWrapPoints', number: 'INV-2026-0000000000000000000000000000123', totalAmount: 123456789012345 }
    const html = render({ items: [invoice] })
    const table = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/)?.[0]
    expect(table).toBeDefined()
    expect(table?.match(/<th\b/g)).toHaveLength(7)
    expect(table?.match(/<td\b/g)).toHaveLength(7)
    for (const value of [invoice.orgName, invoice.number, 'US$123,456,789,012,345', 'USD', 'Viewed', 'Stripe, link live', invoice.dueDate!, invoiceDueLabel(invoice), invoiceAgeLabel(invoice)]) expect(table).toContain(value)
    expect(table).toContain('href="/clients/org-a"')
    expect(table).toContain('href="/invoices/inv-1"')
  })
  it('keeps the actual invoice pager and page-size choices available for a multi-page ledger', () => {
    const html = render({ items: Array.from({ length: 21 }, (_, index) => ({ ...base, id: `inv-${index}`, number: `INV-${String(index).padStart(3, '0')}` })) })
    const table = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/)?.[0]
    expect(table?.match(/<td\b/g)).toHaveLength(20 * 7)
    expect(html).toContain('1 / 2')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous page"/)
    expect(html).toMatch(/<button[^>]*aria-label="Next page"/)
    expect(html).toContain('>All</option>')
    expect(table).not.toContain('INV-020')
  })
  it('withholds every KPI and view count while reading the full ledger', () => {
    const html = render({ complete: false, loading: true })
    expect(html).toContain('animate-pulse')
    expect(html).toContain('Counts wait for the complete ledger.')
    expect(html).not.toContain('Sitting in drafts')
    expect(html).not.toContain('1 invoice out')
    expect(html).toContain('These are loaded rows only')
  })
  it('shows later-page failure as incomplete, keeps loaded rows and offers Retry with no totals', () => {
    const html = render({ complete: false, error: new ApiError(500) })
    expect(html).toContain('We could not load the ledger')
    expect(html).toContain('Ledger incomplete')
    expect(html).toContain('INV-2026-001')
    expect(html).toContain('Retry')
    expect(html).not.toContain('Sitting in drafts')
  })
  it('does not disguise the pagination cap as a complete ledger', () => {
    const html = render({ complete: false, capped: true })
    expect(html).toContain('The ledger read reached its limit')
    expect(html).toContain('Only the first 1 invoices were read')
    expect(html).not.toContain('Sitting in drafts')
  })
  it('shows feature denial without cached invoice rows or an ineffective Retry', () => {
    const html = render({ items: [], complete: false, error: new ApiError(403) })
    expect(html).toContain('Invoices are not on your seat')
    expect(html).not.toContain('INV-2026-001')
    expect(html).not.toContain('Retry')
    expect(html).not.toContain('No invoices yet')
  })
  it('distinguishes an empty scope from an empty ledger', () => {
    const scoped = render({ items: [], scopeNone: true })
    expect(scoped).toContain('No client is in your scope yet')
    expect(scoped).not.toContain('No invoices yet')
    const empty = render({ items: [] })
    expect(empty).toContain('No invoices yet')
    expect(empty).toContain('Raise the first one')
  })
  it('refreshes the aggregate after recovery and creation, retaining detail navigation', () => {
    render()
    captured.imported?.()
    expect(captured.mutate).toHaveBeenCalledTimes(1)
    captured.created?.('new-invoice')
    expect(captured.mutate).toHaveBeenCalledTimes(2)
    expect(captured.push).toHaveBeenCalledExactlyOnceWith('/invoices/new-invoice')
  })
  it('keeps import counts and refreshes the complete ledger on successful Stripe import', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ imported: 2, updated: 3, skipped: 4 })))
    try {
      render()
      await captured.buttons.get('Import from Stripe')?.(undefined as never)
      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/admin/integrations/stripe/import-invoices', { method: 'POST' })
      expect(captured.toast).toHaveBeenCalledExactlyOnceWith('Stripe: 2 imported, 3 updated, 4 skipped')
      expect(captured.mutate).toHaveBeenCalledTimes(1)
    } finally { fetchSpy.mockRestore() }
  })
  it('keeps a refused Stripe import honest and does not claim a refresh or success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
    try {
      render()
      await captured.buttons.get('Import from Stripe')?.(undefined as never)
      expect(captured.toast).toHaveBeenCalledExactlyOnceWith('Forbidden')
      expect(captured.mutate).not.toHaveBeenCalled()
    } finally { fetchSpy.mockRestore() }
  })
  it('wires Retry to the same full-ledger refresh', async () => {
    render({ complete: false, error: new ApiError(500) })
    await captured.buttons.get('Retry')?.(undefined as never)
    expect(captured.mutate).toHaveBeenCalledTimes(1)
  })
})
describe('preserved client branch and mobile presentation', () => {
  it.each([false, true])('uses the existing portal SWR key and pay CTA for client lens (per-tab %s)', perTab => {
    vi.mocked(useImpersonation).mockReturnValue({ isImpersonatingClient: perTab } as ReturnType<typeof useImpersonation>)
    const html = renderToStaticMarkup(<SWRConfig value={{ provider: () => new Map(), fallback: { '/api/portal/invoices': { items: [{ ...base, payUrl: 'https://stripe.example/portal-pay' }] } } }}>
      <InvoiceList isAdmin={perTab} />
    </SWRConfig>)
    expect(useAllInvoices).not.toHaveBeenCalled()
    expect(html).toContain('https://stripe.example/portal-pay')
    expect(html).toContain('Pay now')
    expect(html).not.toContain('Create invoice')
    expect(html).not.toContain('Import from Stripe')
    expect(html).not.toContain('Recover paid Stripe invoice')
    expect(html).not.toContain('Sitting in drafts')
  })
  it('uses explicit touch links, privacy tags, native currency and tokens in the mobile card', () => {
    const html = renderToStaticMarkup(<InvoiceMobileRow invoice={base} currency="NZD" rates={[]} />)
    expect(html).toContain('min-h-11')
    expect(html).toContain('tahi-focus-ring')
    expect(html).toContain('data-private')
    expect(html).toContain('var(--color-link)')
    expect(html).toContain('USD')
    expect(html).not.toContain('NZ$100')
    expect(html).toContain('href="/invoices/inv-1"')
  })
  it('shows separate native KPI values when a mixed-currency aggregate cannot be converted', () => {
    const html = renderToStaticMarkup(<InvoicesBand invoices={[base, { ...base, id: 'nzd', currency: 'NZD', totalAmount: 200 }]} currency="GBP" rates={[]} />)
    expect(html).toContain('NZ$200')
    expect(html).toContain('US$100')
    expect(html).not.toContain('£300')
    expect(html).toContain('Native totals are shown separately')
  })
  it('keeps an ordinary KPI amount on one line and approximation on its own line', () => {
    const money = invoiceMoneyTotal([{ ...base, totalAmount: 7275.625 }], 'NZD', [{ currency: 'NZD', rateToUsd: 1.6 }, { currency: 'USD', rateToUsd: 1 }])
    const html = renderToStaticMarkup(<InvoiceTotalValue money={money} />)
    expect(html).toContain('>≈ NZD</span>')
    expect(html).toContain('white-space:nowrap')
    expect(html).toContain('>NZ$11,641</span>')
    expect(html).not.toContain('≈ NZ$11,641')
  })
  it('allows unusually large values to break safely while keeping the full amount', () => {
    const html = renderToStaticMarkup(<InvoiceTotalValue money={invoiceMoneyTotal([{ ...base, totalAmount: 123456789012345 }], 'USD', [])} />)
    expect(html).toContain('US$123,456,789,012,345')
    expect(html).toContain('white-space:normal')
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html).toContain('font-size:0.875rem')
  })
})
