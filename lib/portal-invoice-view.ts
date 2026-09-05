/**
 * lib/portal-invoice-view.ts
 *
 * What a CLIENT is told about an invoice.
 *
 * The studio has seven invoice statuses. A client has three words: Awaiting
 * payment, Overdue, Paid. Draft and Written off are studio accounting states
 * and never reach a portal projection at all (both portal routes exclude
 * drafts); Sent and Viewed are the studio's read receipt, not a fact the payer
 * needs. So the client vocabulary is derived here, once, and every client
 * money surface reads it rather than mapping the raw column itself.
 *
 * Two rules worth stating out loud, because the shared admin list gets both
 * differently:
 *
 *   Overdue is derived from the due date for ANY unpaid invoice, not only for
 *   one stored as 'sent'. Otherwise a client who opened their invoice (status
 *   'viewed') keeps reading "Viewed" a month after it fell due.
 *
 *   Nothing is ever converted. Every figure renders in the invoice's own
 *   currency: the portal has no exchange rates, so a converted figure would be
 *   a number the client cannot reconcile against their own bank.
 *
 * Pure and dependency-light on purpose: it runs in the browser.
 */

import { isInvoiceSettled } from '@/lib/invoice-how-to-pay'
import { formatCurrency } from '@/lib/currency'

/** The three words a client sees. */
export type PortalInvoiceState = 'awaiting' | 'overdue' | 'paid'

/** The fields any client money surface needs to say what an invoice is doing. */
export interface PortalInvoiceLike {
  status: string
  dueDate: string | null
  paidAt?: string | null
}

export interface PortalInvoiceStateCopy {
  label: string
  /** Badge tone token, so nothing here hardcodes a colour. */
  tone: 'warning' | 'danger' | 'positive'
}

export const PORTAL_INVOICE_STATE_COPY: Record<PortalInvoiceState, PortalInvoiceStateCopy> = {
  awaiting: { label: 'Awaiting payment', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  paid: { label: 'Paid', tone: 'positive' },
}

/** Midnight-safe end of the due day, so an invoice due today is not late. */
function dueMoment(dueDate: string): number {
  const iso = dueDate.includes('T') ? dueDate : `${dueDate}T23:59:59`
  return new Date(iso).getTime()
}

/**
 * The client-facing state of one invoice.
 *
 * A settled bill (paid, written off, cancelled, or carrying a paidAt) is Paid
 * to the client: "written off" is the studio deciding not to chase it, and
 * telling the payer their bill is "written off" invites a phone call about
 * money nobody wants.
 */
export function portalInvoiceState(
  invoice: PortalInvoiceLike,
  now: Date = new Date(),
): PortalInvoiceState {
  if (isInvoiceSettled(invoice)) return 'paid'
  if (invoice.dueDate && dueMoment(invoice.dueDate) < now.getTime()) return 'overdue'
  return 'awaiting'
}

/** Still owed: the set every "to pay" figure on the client surfaces counts. */
export function isPortalInvoiceOpen(invoice: PortalInvoiceLike): boolean {
  return !isInvoiceSettled(invoice)
}

/** Whole days from now until the due date. Negative once it is late. */
export function daysUntilDue(dueDate: string, now: Date = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const due = dueDate.includes('T') ? dueDate.slice(0, 10) : dueDate
  const parts = due.split('-')
  const target = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime()
  return Math.round((target - start) / 86400000)
}

/**
 * One relative phrase, used in the row and in the hero so the two never print
 * the same date twice in different words.
 */
export function portalDueLabel(
  invoice: PortalInvoiceLike,
  now: Date = new Date(),
): string {
  if (isInvoiceSettled(invoice)) {
    return invoice.paidAt ? `Paid ${formatPortalDate(invoice.paidAt)}` : 'Paid'
  }
  if (!invoice.dueDate) return 'No due date'
  const days = daysUntilDue(invoice.dueDate, now)
  if (days < 0) {
    const late = Math.abs(days)
    return `${late} ${late === 1 ? 'day' : 'days'} overdue`
  }
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days <= 14) return `Due in ${days} days`
  return `Due ${formatPortalDate(invoice.dueDate)}`
}

/**
 * The relative half of the due date, for the places that already print the
 * date itself.
 *
 * Null once the date is far enough away to speak for itself, so a row never
 * reads "30 Oct 2026 / Due 30 Oct 2026".
 */
export function portalDueRelative(
  invoice: PortalInvoiceLike,
  now: Date = new Date(),
): string | null {
  if (isInvoiceSettled(invoice)) return null
  if (!invoice.dueDate) return null
  const days = daysUntilDue(invoice.dueDate, now)
  if (days < 0) {
    const late = Math.abs(days)
    return `${late} ${late === 1 ? 'day' : 'days'} overdue`
  }
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days <= 30) return `Due in ${days} days`
  return null
}

/**
 * The whole due sentence for a hero, which owns both halves and so must not
 * say the same thing twice.
 */
export function portalDueSentence(
  invoice: PortalInvoiceLike,
  now: Date = new Date(),
): string {
  if (isInvoiceSettled(invoice)) {
    return invoice.paidAt
      ? `Paid ${formatPortalDateLong(invoice.paidAt)}.`
      : 'Settled. There is nothing left to pay on this one.'
  }
  if (!invoice.dueDate) {
    return 'No due date on this one. Ask us if you would like one set.'
  }
  const date = formatPortalDateLong(invoice.dueDate)
  const days = daysUntilDue(invoice.dueDate, now)
  if (days < 0) {
    const late = Math.abs(days)
    return `Due ${date}, ${late} ${late === 1 ? 'day' : 'days'} overdue.`
  }
  if (days === 0) return `Due today, ${date}.`
  if (days === 1) return `Due tomorrow, ${date}.`
  return `Due ${date}, in ${days} days.`
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "4 Sep 2026". Never a locale call on a server-rendered node. */
export function formatPortalDate(value: string | null | undefined): string {
  if (!value) return 'Not set'
  const day = value.includes('T') ? value.slice(0, 10) : value
  const parts = day.split('-')
  if (parts.length !== 3) return day
  const month = MONTHS[Number(parts[1]) - 1]
  if (!month) return day
  return `${Number(parts[2])} ${month.slice(0, 3)} ${Number(parts[0])}`
}

/** "4 September 2026", for the places that read as a sentence. */
export function formatPortalDateLong(value: string | null | undefined): string {
  if (!value) return 'Not set'
  const day = value.includes('T') ? value.slice(0, 10) : value
  const parts = day.split('-')
  if (parts.length !== 3) return day
  const month = MONTHS[Number(parts[1]) - 1]
  if (!month) return day
  return `${Number(parts[2])} ${month} ${Number(parts[0])}`
}

/** The calendar year an ISO date falls in, for the year filter. */
export function yearOf(value: string | null | undefined): string | null {
  if (!value) return null
  const year = value.slice(0, 4)
  return /^\d{4}$/.test(year) ? year : null
}

/**
 * A human name for an invoice.
 *
 * `invoices` has no title and no number column (IC.7 still owes the number),
 * so the client gets the month the bill covers plus the reference they quote
 * on a transfer. "September invoice" is what they call it on the phone.
 */
export function portalInvoiceLabel(invoice: {
  dueDate: string | null
  sentAt?: string | null
  createdAt?: string | null
}): string {
  const anchor = invoice.dueDate ?? invoice.sentAt ?? invoice.createdAt ?? null
  const month = anchor ? MONTHS[Number(anchor.slice(5, 7)) - 1] : null
  return month ? `${month} invoice` : 'Invoice'
}

/** One currency's worth of invoices. */
export interface CurrencyTotal {
  currency: string
  total: number
}

/**
 * Sum a set of invoices per currency.
 *
 * Never one number across currencies: NZ$2,300 plus US$500 is not 2,800 of
 * anything, and the portal holds no rates to make it one.
 */
export function sumByCurrency(
  invoices: ReadonlyArray<{ totalAmount: number; currency: string | null }>,
): CurrencyTotal[] {
  const bucket = new Map<string, number>()
  for (const invoice of invoices) {
    const currency = invoice.currency ?? 'NZD'
    bucket.set(currency, (bucket.get(currency) ?? 0) + (invoice.totalAmount ?? 0))
  }
  return [...bucket.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total)
}

/** "NZ$2,300.00", or "NZ$2,300.00 + US$500.00" when a client is billed in two. */
export function formatCurrencyTotals(totals: readonly CurrencyTotal[]): string {
  if (totals.length === 0) return formatPortalMoney(0, 'NZD')
  return totals.map(t => formatPortalMoney(t.total, t.currency)).join(' + ')
}

/** Cents matter on a bill, so money on these surfaces always carries them. */
export function formatPortalMoney(amount: number, currency: string | null): string {
  return formatCurrency(amount, currency ?? 'NZD', { decimals: 2 })
}
