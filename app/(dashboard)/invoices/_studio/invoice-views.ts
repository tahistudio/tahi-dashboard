import { invoiceDaysPastDue, invoicePayState, invoiceStudioDay, type InvoicePayFields } from '@/lib/invoice-pay-state'
import { isDraftInvoice, isOwedInvoice, isPaidInvoice, normaliseInvoiceStatus } from '@/lib/invoice-status'
import { invoiceReference } from '@/lib/invoice-billing'
import type { ExchangeRate } from '@/lib/currency'

export interface StudioInvoice extends InvoicePayFields {
  id: string
  orgId: string
  orgName: string | null
  number?: string | null
  stripeInvoiceId?: string | null
  totalAmount: number
  currency: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
  sentAt?: string | null
  viewedAt?: string | null
  paidAt?: string | null
}
export const INVOICE_VIEWS = [
  { key: 'all', label: 'All invoices' }, { key: 'owed', label: 'Owed' },
  { key: 'overdue', label: 'Overdue' }, { key: 'no_pay', label: 'No payment page' },
  { key: 'paid_month', label: 'Paid this month' }, { key: 'drafts', label: 'Drafts' },
] as const
export type InvoiceView = (typeof INVOICE_VIEWS)[number]['key']
export interface InvoiceFilters { status: string; source: string; client: string; from: string; to: string }
export const DEFAULT_INVOICE_FILTERS: InvoiceFilters = { status: 'all', source: 'all', client: 'all', from: '', to: '' }
export const nativeCurrency = (code: string | null) => code === null ? 'NZD' : code.trim().toUpperCase() || 'Unknown'

export function invoicePaidThisMonth(inv: StudioInvoice, now = new Date()): boolean {
  if (!isPaidInvoice(inv.status) || !inv.paidAt) return false
  const day = invoiceStudioDay(new Date(inv.paidAt))
  return !!day && day.slice(0, 7) === invoiceStudioDay(now).slice(0, 7)
}
export function invoiceViewMatches(inv: StudioInvoice, view: InvoiceView, now = new Date()): boolean {
  switch (view) {
    case 'all': return true
    case 'owed': return isOwedInvoice(inv.status)
    case 'overdue': return invoiceDaysPastDue(inv, now) > 0
    case 'no_pay': return isOwedInvoice(inv.status) && ['missing', 'held'].includes(invoicePayState(inv).key)
    case 'paid_month': return invoicePaidThisMonth(inv, now)
    case 'drafts': return isDraftInvoice(inv.status)
  }
}
export function invoiceViewCounts(rows: readonly StudioInvoice[], now = new Date()): Record<InvoiceView, number> {
  return Object.fromEntries(INVOICE_VIEWS.map(view => [view.key, rows.filter(row => invoiceViewMatches(row, view.key, now)).length])) as Record<InvoiceView, number>
}
export function invoiceDisplayStatus(inv: StudioInvoice, now = new Date()): string {
  return invoiceDaysPastDue(inv, now) > 0 ? 'overdue' : normaliseInvoiceStatus(inv.status)
}
export function filterInvoiceRows(rows: readonly StudioInvoice[], view: InvoiceView, filters: InvoiceFilters, query: string, now = new Date()): StudioInvoice[] {
  const needle = query.trim().toLowerCase()
  return rows.filter(inv => {
    if (!invoiceViewMatches(inv, view, now)) return false
    if (filters.status !== 'all' && invoiceDisplayStatus(inv, now) !== filters.status) return false
    if (filters.source !== 'all' && (inv.source ?? 'manual') !== filters.source) return false
    if (filters.client !== 'all' && inv.orgId !== filters.client) return false
    // Due filters concern due dates alone. Undated invoices remain in the unfiltered ledger.
    if (filters.from && (!inv.dueDate || inv.dueDate < filters.from)) return false
    if (filters.to && (!inv.dueDate || inv.dueDate > filters.to)) return false
    return !needle || [inv.orgName, invoiceReference(inv.id, inv.number), inv.id, inv.stripeInvoiceId, inv.xeroInvoiceId]
      .some(value => value?.toLowerCase().includes(needle))
  })
}
export interface NativeTotal { currency: string; total: number }
export interface InvoiceMoneyTotal {
  total: number | null
  currency: string
  native: NativeTotal[]
  converted: boolean
  invalidAmount: boolean
}
/** No shared converter fallback: every required raw rate must be finite and positive. */
export function invoiceMoneyTotal(rows: readonly StudioInvoice[], displayCurrency: string, rates: readonly ExchangeRate[]): InvoiceMoneyTotal {
  const currency = nativeCurrency(displayCurrency)
  const grouped = new Map<string, number>()
  const validRates = new Map<string, number>()
  const duplicates = new Set<string>()
  for (const rate of rates) {
    const code = nativeCurrency(rate.currency)
    if (validRates.has(code)) duplicates.add(code)
    validRates.set(code, rate.rateToUsd)
  }
  const validRate = (code: string) => {
    const rate = validRates.get(code)
    return !duplicates.has(code) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null
  }
  let total = 0
  let convertible = true
  let converted = false
  let invalidAmount = false
  for (const row of rows) {
    const code = nativeCurrency(row.currency)
    if (!Number.isFinite(row.totalAmount)) { invalidAmount = true; convertible = false; continue }
    grouped.set(code, (grouped.get(code) ?? 0) + row.totalAmount)
    if (code === currency) total += row.totalAmount
    else {
      const source = validRate(code)
      const target = validRate(currency)
      if (source === null || target === null || validRate('NZD') === null) convertible = false
      else { total += row.totalAmount / source * target; converted = true }
    }
  }
  const native = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([code, amount]) => ({ currency: code, total: amount }))
  if (!Number.isFinite(total) || native.some(group => !Number.isFinite(group.total))) { invalidAmount = true; convertible = false }
  return { total: convertible ? total : null, currency, native, converted: convertible && converted, invalidAmount }
}
export function invoiceBandRows(rows: readonly StudioInvoice[], now = new Date()) {
  return {
    owed: rows.filter(row => isOwedInvoice(row.status)),
    overdue: rows.filter(row => invoiceDaysPastDue(row, now) > 0),
    collected: rows.filter(row => invoicePaidThisMonth(row, now)),
    drafts: rows.filter(row => isDraftInvoice(row.status)),
  }
}
