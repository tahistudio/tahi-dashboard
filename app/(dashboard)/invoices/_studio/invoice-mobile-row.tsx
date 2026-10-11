import Link from 'next/link'
import { formatCurrency, type ExchangeRate } from '@/lib/currency'
import { invoiceReference } from '@/lib/invoice-billing'
import { invoiceAgeLabel, invoiceDueLabel, invoiceDaysPastDue } from '@/lib/invoice-pay-state'
import { InvoiceStatusBadge } from '../invoice-status'
import { RailChip } from '../rail-chip'
import { invoiceDisplayStatus, invoiceMoneyTotal, nativeCurrency, type StudioInvoice } from './invoice-views'

export function InvoiceAmount({ invoice, currency, rates }: { invoice: StudioInvoice; currency: string; rates: readonly ExchangeRate[] }) {
  const native = nativeCurrency(invoice.currency)
  const equivalent = invoiceMoneyTotal([invoice], currency, rates)
  return <span data-private className="block tabular-nums" style={{ overflowWrap: 'anywhere' }}>
    {Number.isFinite(invoice.totalAmount) ? `${formatCurrency(invoice.totalAmount, native)} ${native}` : 'Amount unavailable'}
    {native !== currency && equivalent.total !== null && <span className="block text-xs" style={{ color: 'var(--color-text-subtle)' }}>≈ {formatCurrency(equivalent.total, currency)} {currency}</span>}
  </span>
}
export function InvoiceMobileRow({ invoice, currency, rates }: { invoice: StudioInvoice; currency: string; rates: readonly ExchangeRate[] }) {
  return <article className="flex flex-col min-w-0" style={{ gap: '0.625rem', padding: '1rem' }}>
    <div className="flex items-start justify-between flex-wrap" style={{ gap: '0.5rem' }}>
      <Link href={`/clients/${invoice.orgId}`} data-row-control data-private className="tahi-focus-ring inline-flex items-center min-h-11 text-sm font-semibold hover:underline" style={{ color: 'var(--color-link)', overflowWrap: 'anywhere' }}>{invoice.orgName ?? 'Client'}</Link>
      <InvoiceStatusBadge status={invoiceDisplayStatus(invoice)} dueDate={null} />
    </div>
    <InvoiceAmount invoice={invoice} currency={currency} rates={rates} />
    <Link href={`/invoices/${invoice.id}`} data-row-control data-private className="tahi-focus-ring inline-flex items-center min-h-11 text-sm font-mono hover:underline" style={{ color: 'var(--color-link)', overflowWrap: 'anywhere' }}>Open {invoiceReference(invoice.id, invoice.number)}</Link>
    <div><RailChip invoice={invoice} full /></div>
    <span className="text-xs" style={{ color: invoiceDaysPastDue(invoice) ? 'var(--color-danger-ink)' : 'var(--color-text-muted)' }}>{invoice.dueDate ? `${invoice.dueDate}, ` : ''}{invoiceDueLabel(invoice)}</span>
    <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>{invoiceAgeLabel(invoice)}</span>
  </article>
}
