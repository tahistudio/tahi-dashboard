/**
 * The studio invoice detail, in its three states.
 *
 * The repo's Vitest runs in the `node` environment with no DOM and no
 * @testing-library (see data-table-expand.test.ts and segmented-control.test.tsx),
 * so this covers the server markup the page hydrates from: the first-paint
 * skeleton, the load failure with its Retry, and a populated invoice rendered
 * through the real component with SWR answering from a `fallback` map.
 *
 * What it is guarding is the T2.10 port. The page used to hand roll its own
 * buttons, its own status colour map, its own header and its own table, and
 * the swap onto <PageHeader> / <TahiButton> / <InvoiceStatusBadge> /
 * <DataTable> had to keep every capability: the invoice number as the title
 * with the short id as the fallback, the amount in the invoice's own currency,
 * every action button, the line items, the totals, and the rail facts.
 *
 * The live half (clicking Mark as Paid, the two confirmations, the clipboard)
 * belongs in Playwright, not here.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SWRConfig } from 'swr'

// The page calls useRouter() to leave for /invoices after a delete. Outside a
// Next app-router tree that context is empty, so the hook is stubbed rather
// than the whole navigation surface being mounted.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/invoices/inv-1',
}))

const { InvoiceDetail, InvoiceDetailSkeleton, InvoiceLoadFailed, pushbackCopy, sendResultMessage } =
  await import('@/app/(dashboard)/invoices/[id]/invoice-detail')

const INVOICE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const baseInvoice = {
  id: INVOICE_ID,
  orgId: 'org-1',
  orgName: 'Kowtow',
  projectId: null,
  subscriptionId: null,
  stripeInvoiceId: null,
  xeroInvoiceId: null,
  stripeHostedInvoiceUrl: null,
  xeroOnlineInvoiceUrl: null,
  source: 'xero',
  status: 'draft',
  number: 'INV-2026-0007',
  amountUsd: 1200,
  taxAmountUsd: 180,
  discountAmountUsd: 0,
  totalUsd: 1380,
  currency: 'NZD',
  notes: 'Second milestone.',
  dueDate: '2026-10-01',
  sentAt: null,
  viewedAt: null,
  paidAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

const items = [
  {
    id: 'li-1',
    invoiceId: INVOICE_ID,
    description: 'Template build',
    quantity: 2,
    unitPriceUsd: 600,
    totalUsd: 1200,
  },
]

/** The page, with SWR answering the admin detail key from cache. */
function renderInvoice(invoice: Record<string, unknown>, rows = items): string {
  return renderToStaticMarkup(
    <SWRConfig value={{ fallback: { [`/api/admin/invoices/${INVOICE_ID}`]: { invoice, items: rows } } }}>
      <InvoiceDetail invoiceId={INVOICE_ID} isAdmin />
    </SWRConfig>,
  )
}

describe('invoice detail: loading', () => {
  it('paints a pulsing skeleton, not an empty page', () => {
    const html = renderToStaticMarkup(<InvoiceDetailSkeleton />)
    expect(html).toContain('animate-pulse')
    // The skeleton has to claim the same two-column shape the loaded page
    // takes, or the layout jumps when the data lands.
    expect(html).toContain('md:grid-cols-[1fr_16rem]')
  })
})

describe('invoice detail: error', () => {
  it('says the load failed and offers Retry', () => {
    const html = renderToStaticMarkup(<InvoiceLoadFailed onRetry={() => {}} />)
    expect(html).toContain('Failed to load invoice.')
    expect(html).toContain('Retry')
    expect(html).toContain('Back to Invoices')
  })

  it('does not offer Retry on a 404, which retrying cannot fix', () => {
    const html = renderToStaticMarkup(<InvoiceLoadFailed notFound onRetry={() => {}} />)
    expect(html).toContain('Invoice not found.')
    expect(html).not.toContain('Retry')
  })
})

describe('invoice detail: populated', () => {
  const html = renderInvoice(baseInvoice)

  it('titles the page with the invoice number', () => {
    expect(html).toContain('INV-2026-0007')
    expect(html).toContain('Kowtow')
    // The label next to the reference in the rail names what it is, so nobody
    // quotes a UUID fragment to Xero believing it is an invoice number.
    expect(html).toContain('Invoice number')
  })

  it('falls back to the short id when the row has no number', () => {
    const noNumber = renderInvoice({ ...baseInvoice, number: null })
    expect(noNumber).toContain('A1B2C3D4')
    expect(noNumber).toContain('Invoice ID')
  })

  it('shows the amount in the invoice currency', () => {
    expect(html).toContain('NZ$1,380')
    // The line rate and the line total are the invoice's currency too, never
    // the session's display currency.
    expect(html).toContain('NZ$600')
    expect(html).toContain('NZ$1,200')
  })

  it('lists the line items with their totals', () => {
    expect(html).toContain('Template build')
    expect(html).toContain('Unit price')
    expect(html).toContain('Subtotal')
    expect(html).toContain('GST (15%)')
    expect(html).toContain('Total')
  })

  it('is honest when an invoice has no lines', () => {
    const noLines = renderInvoice(baseInvoice, [])
    expect(noLines).toContain('No line items on this invoice.')
  })

  it('offers the draft actions and withholds the ones a draft cannot take', () => {
    expect(html).toContain('Email to client')
    expect(html).toContain('Sync to Xero')
    expect(html).toContain('Create Stripe Link')
    expect(html).toContain('Void Invoice')
    expect(html).toContain('Delete Invoice')
    // Nobody has been asked for this money yet, so there is nothing to mark
    // paid and nothing to revert to.
    expect(html).not.toContain('Mark as Paid')
    expect(html).not.toContain('Revert to Draft')
  })

  it('offers Mark as Paid and Resend once the invoice has been sent', () => {
    const sent = renderInvoice({ ...baseInvoice, status: 'sent', sentAt: '2026-09-02T00:00:00.000Z' })
    expect(sent).toContain('Mark as Paid')
    expect(sent).toContain('Resend email')
    expect(sent).toContain('Revert to Draft')
  })

  it('stops offering to chase money that has landed', () => {
    const paid = renderInvoice({ ...baseInvoice, status: 'paid', paidAt: '2026-09-05T00:00:00.000Z' })
    expect(paid).toContain('Paid')
    expect(paid).not.toContain('Email to client')
    expect(paid).not.toContain('Mark as Paid')
    expect(paid).not.toContain('Void Invoice')
  })

  it('shows both pay pages when the rails have issued them', () => {
    const payable = renderInvoice({
      ...baseInvoice,
      status: 'sent',
      stripeInvoiceId: 'in_123',
      stripeHostedInvoiceUrl: 'https://pay.stripe.test/inv',
      xeroOnlineInvoiceUrl: 'https://xero.test/pay',
      xeroInvoiceId: 'xero-invoice-id-1',
    })
    expect(payable).toContain('Client pay page')
    expect(payable).toContain('Xero pay page')
    expect(payable).toContain('What the client sees when they pay.')
    expect(payable).toContain('Copy Payment Link')
    expect(payable).toContain('Stripe ID')
    expect(payable).toContain('Xero ID')
  })
})

// The two sentences the page says after a write. Pure, and the reason a human
// can act on lives in `detail` rather than in the toast, which clips.
describe('invoice detail: outcome copy', () => {
  it('does not claim a rail was told when there is no rail', () => {
    expect(pushbackCopy(undefined)).toEqual({ toast: 'Marked paid.', tone: 'success', detail: null })
  })

  it('carries the reason a rail refused the payment', () => {
    const copy = pushbackCopy({ rail: 'xero', status: 'skipped', reason: 'Xero invoice is still a draft' })
    expect(copy.tone).toBe('info')
    expect(copy.detail).toBe('Marked paid here. Xero was not told: Xero invoice is still a draft')
  })

  it('reports a failed delivery even when Xero sent its own copy', () => {
    const result = sendResultMessage({ sentTo: [], failedTo: ['pay@kowtow.test'], xeroEmail: 'sent' })
    expect(result.tone).toBe('partial')
    expect(result.message).toContain('Could not reach pay@kowtow.test.')
    expect(result.message).toContain('Xero emailed this invoice to the client.')
  })
})
