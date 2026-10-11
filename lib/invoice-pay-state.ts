import { isDraftInvoice, isOwedInvoice, isPaidInvoice, isVoidInvoice } from '@/lib/invoice-status'
import { resolveInvoicePayUrl } from '@/lib/invoice-how-to-pay'
import type { BadgeTone } from '@/components/tahi/badge'

export interface InvoicePayFields {
  status: string
  source?: string | null
  stripeHostedInvoiceUrl?: string | null
  xeroOnlineInvoiceUrl?: string | null
  xeroInvoiceId?: string | null
}
export interface InvoiceDateFields {
  status: string
  dueDate: string | null
  createdAt: string
  paidAt?: string | null
}
export type InvoicePayKey = 'paid' | 'void' | 'live' | 'pending' | 'missing' | 'held' | 'bank'
export interface InvoicePayState { key: InvoicePayKey; tone: BadgeTone; short: string; long: string }
const state = (key: InvoicePayKey, tone: BadgeTone, short: string, long: string): InvoicePayState => ({ key, tone, short, long })

export function invoiceRailLabel(inv: InvoicePayFields): string {
  return inv.source === 'stripe' ? 'Stripe' : inv.source === 'xero' ? 'Xero' : 'Manual'
}
export function invoicePayState(inv: InvoicePayFields): InvoicePayState {
  if (isPaidInvoice(inv.status)) return state('paid', 'positive', 'settled', 'This invoice is paid.')
  if (isVoidInvoice(inv.status)) return state('void', 'neutral', 'voided', 'This invoice is no longer owed.')
  if (isDraftInvoice(inv.status)) return state('pending', 'neutral', 'no link yet', 'This is a studio draft. Nothing is owed yet.')
  if (!isOwedInvoice(inv.status)) return state('pending', 'neutral', 'not issued', 'This status does not establish an unpaid bill.')
  if (resolveInvoicePayUrl(inv.stripeHostedInvoiceUrl, inv.xeroOnlineInvoiceUrl)) {
    return resolveInvoicePayUrl(inv.stripeHostedInvoiceUrl, null)
      ? state('live', 'positive', 'link live', 'A Stripe payment page is stored for this invoice.')
      : state('live', 'positive', 'pay page', 'A Xero online invoice page is stored for this invoice.')
  }
  if (inv.source === 'stripe') {
    return state('missing', 'danger', 'no link', 'No payment page is stored. Sending email does not create one.')
  }
  if (inv.source === 'xero') {
    return inv.xeroInvoiceId
      ? state('held', 'warning', 'no pay page', 'Linked to Xero, but no online page is stored. Check approval and the page sync in Xero. Bank-transfer instructions may still be available.')
      : state('missing', 'warning', 'not pushed', 'This invoice has not been linked to Xero. Bank-transfer instructions may still be available.')
  }
  return state('bank', 'neutral', 'bank', 'This invoice uses the studio bank-transfer instructions.')
}

/** Calendar comparisons use the studio day, independent of the operator's browser timezone. */
export function invoiceStudioDay(date: Date): string {
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (kind: string) => parts.find(p => p.type === kind)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
function calendarOrdinal(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const date = new Date(`${day}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? date.getTime() / 86400000 : null
}
export function invoiceDaysPastDue(inv: Pick<InvoiceDateFields, 'status' | 'dueDate'>, now = new Date()): number {
  if (!isOwedInvoice(inv.status) || !inv.dueDate) return 0
  const due = calendarOrdinal(inv.dueDate)
  const today = calendarOrdinal(invoiceStudioDay(now))
  return due === null || today === null ? 0 : Math.max(0, today - due)
}
export function invoiceDueLabel(inv: Pick<InvoiceDateFields, 'status' | 'dueDate'>, now = new Date()): string {
  if (isPaidInvoice(inv.status)) return 'Paid'
  if (isVoidInvoice(inv.status)) return 'No longer owed'
  if (isDraftInvoice(inv.status)) return 'Not issued'
  if (!isOwedInvoice(inv.status)) return 'Not issued'
  if (!inv.dueDate || calendarOrdinal(inv.dueDate) === null) return 'No due date'
  const overdue = invoiceDaysPastDue(inv, now)
  if (overdue) return `${overdue} ${overdue === 1 ? 'day' : 'days'} overdue`
  const today = calendarOrdinal(invoiceStudioDay(now))
  const due = calendarOrdinal(inv.dueDate)
  if (today === null || due === null) return 'No due date'
  const days = due - today
  return days === 0 ? 'Due today' : `Due in ${days} ${days === 1 ? 'day' : 'days'}`
}
export function invoiceAgeLabel(inv: InvoiceDateFields, now = new Date()): string {
  const created = calendarOrdinal(invoiceStudioDay(new Date(inv.createdAt)))
  const end = calendarOrdinal(invoiceStudioDay(new Date(inv.paidAt || now)))
  if (created === null || end === null || end < created) return 'Age unavailable'
  const days = end - created
  if (inv.paidAt && !isDraftInvoice(inv.status)) return `Paid in ${days} ${days === 1 ? 'day' : 'days'}`
  return `${days} ${days === 1 ? 'day' : 'days'} ${isDraftInvoice(inv.status) ? 'in draft' : 'since raised'}`
}
