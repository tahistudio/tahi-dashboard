import { Banknote, Clock, FileText, Wallet } from 'lucide-react'
import { KPICell, KPIStrip } from '@/components/tahi/kpi-strip'
import { formatCurrency } from '@/lib/currency'
import { invoiceDaysPastDue, invoiceStudioDay } from '@/lib/invoice-pay-state'
import { invoiceBandRows, invoiceMoneyTotal, type InvoiceMoneyTotal, type StudioInvoice } from './invoice-views'
import type { ExchangeRate } from '@/lib/currency'

function BandAmount({ value }: { value: string }) {
  const large = value.length > 13
  return <span className="block tabular-nums" style={{
    maxWidth: '100%', fontSize: large ? '0.875rem' : 'clamp(1rem, 1.7vw, 1.375rem)',
    whiteSpace: large ? 'normal' : 'nowrap', overflowWrap: 'anywhere', lineHeight: 1.25,
  }}>{value}</span>
}
export function InvoiceTotalValue({ money }: { money: InvoiceMoneyTotal }) {
  return <span data-private className="block" style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}>
    {money.invalidAmount ? 'Amount unavailable' : money.total !== null
      ? <>{money.converted && <span className="block text-xs" style={{ color: 'var(--color-text-subtle)', marginBottom: '0.125rem' }}>≈ {money.currency}</span>}<BandAmount value={formatCurrency(money.total, money.currency)} /></>
      : <>{money.native.map(group => <BandAmount key={group.currency} value={`${formatCurrency(group.total, group.currency)} ${group.currency}`} />)}</>}
  </span>
}
export function InvoicesBand({ invoices, currency, rates, now = new Date() }: { invoices: StudioInvoice[]; currency: string; rates: readonly ExchangeRate[]; now?: Date }) {
  const rows = invoiceBandRows(invoices, now)
  const totals = Object.fromEntries(Object.entries(rows).map(([key, items]) => [key, invoiceMoneyTotal(items, currency, rates)]))
  const oldest = Math.max(0, ...rows.overdue.map(inv => invoiceDaysPastDue(inv, now)))
  const draftNative = totals.drafts.invalidAmount ? 'amount unavailable' : totals.drafts.native.map(group => `${formatCurrency(group.total, group.currency)} ${group.currency}`).join(' + ')
  const month = new Date(`${invoiceStudioDay(now).slice(0, 7)}-15T00:00:00Z`).toLocaleDateString('en-NZ', { month: 'long', timeZone: 'Pacific/Auckland' })
  const fallback = Object.values(totals).some(money => money.total === null)
  const converted = Object.values(totals).some(money => money.converted)
  return <div className="flex flex-col" style={{ gap: '0.5rem' }}>
    <KPIStrip>
      <KPICell icon={Wallet} label="Outstanding" value={<InvoiceTotalValue money={totals.owed} />} sub={`${rows.owed.length} invoices out`} />
      <KPICell icon={Clock} label="Overdue" tone={rows.overdue.length ? 'danger' : 'neutral'} value={<InvoiceTotalValue money={totals.overdue} />} sub={oldest ? `Oldest is ${oldest} ${oldest === 1 ? 'day' : 'days'} past due` : 'Nothing past due'} />
      <KPICell icon={Banknote} label={`Collected in ${month}`} tone="positive" value={<InvoiceTotalValue money={totals.collected} />} sub="By paid date in the studio month" />
      <KPICell icon={FileText} label="Sitting in drafts" tone="neutral" value={<InvoiceTotalValue money={totals.drafts} />} sub={<span data-private>{rows.drafts.length} drafts{draftNative ? `, ${draftNative}` : ''} not yet issued</span>} />
    </KPIStrip>
    {(fallback || converted) && <p className="text-xs" style={{ margin: 0, color: 'var(--color-text-muted)' }}>
      {fallback ? 'Some exchange rates or amounts are unavailable. Native totals are shown separately where conversion is unavailable.' : `Totals use the available exchange rates to ${currency}. Each invoice keeps the currency it was raised in.`}
    </p>}
  </div>
}
