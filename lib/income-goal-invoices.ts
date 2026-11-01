/**
 * income-goal-invoices.ts: which invoice rows feed Paid, Invoiced and the
 * "older outstanding" footnote on the income goal bar, and at what amount.
 *
 * Pure (no database, no clock). Server side only, because it imports the
 * Stripe twin rules from lib/stripe-dedupe.ts, which reach into the schema.
 *
 * GST. The columns amount_usd / total_usd / tax_amount_usd / discount_amount_usd
 * do not hold USD; they hold the invoice's own currency (see the note on
 * mapInvoiceMoney in lib/import/manyrequests/map.ts). How each source fills them:
 *   - Xero import  amount = Xero SubTotal (ex-tax, after line discounts),
 *                  total = Xero Total (inc tax). tax and discount left at 0.
 *   - ManyRequests amount = subtotal (before tax and before discount),
 *                  total = charged amount, discount = the discount.
 *   - Manual       amount = total = what was typed, no tax column written.
 *   - Stripe in_   amount = Stripe subtotal (before discount and tax),
 *                  total = Stripe total (after discount, with tax)
 *                  (lib/stripe-import.ts).
 *   - Stripe ch_   amount = total = the full amount charged, INCLUDING any GST
 *                  Stripe collected. There is no ex-tax figure for a charge,
 *                  so an un-twinned ch_ row counts any GST in it.
 * tax_amount_usd is NOT reliable (INV-0071 has amount 3000, total 3450, tax 0),
 * so GST is never derived from it. For NZD rows the figure used is
 * amount minus discount; for Stripe rows it is also capped at total, so an
 * invoice-level Stripe discount is respected. Every row is floored at 0: a
 * credit note never reduces the month's income. Non-NZD rows use total
 * (floored), because tax treatment there is unknown.
 *
 * Dates. Stored timestamps come in several shapes (ISO with Z, Xero's naive
 * 'YYYY-MM-DDTHH:MM:SS' which is UTC, a bare date, '/Date(ms+0000)/'). They are
 * all normalised to an instant with normaliseXeroDate before any comparison.
 * An unreadable date is counted in `unknownDate` and never silently dropped.
 */

import {
  findInvoiceTwin,
  isChargeRow,
  isInvoiceRow,
  type InvoiceRowLike,
} from '@/lib/stripe-dedupe'
import { isIssuedInvoice, isOwedInvoice, isPaidInvoice } from '@/lib/invoice-status'
import { normaliseXeroDate } from '@/lib/xero-status'
import type { MoneyItem } from '@/lib/income-goal'

export interface GoalInvoiceRow extends InvoiceRowLike {
  status: string
  amountUsd: number
  discountAmountUsd: number | null
  sentAt: string | null
  /** organisations.stripe_customer_id of the row's organisation, when it has one. */
  stripeCustomerId?: string | null
}

/** The amount a row contributes: ex-GST for NZD, the total otherwise; never negative. */
export function goalAmount(
  row: Pick<GoalInvoiceRow, 'currency' | 'amountUsd' | 'discountAmountUsd' | 'totalUsd'> & { source?: string | null },
): MoneyItem {
  // Blank means USD, the invoices.currency column default.
  const currency = (row.currency ?? '').trim().toUpperCase() || 'USD'
  if (currency === 'NZD') {
    let net = (row.amountUsd ?? 0) - (row.discountAmountUsd ?? 0)
    if (row.source === 'stripe') net = Math.min(net, row.totalUsd ?? net)
    return { amount: Math.max(0, net), currency }
  }
  return { amount: Math.max(0, row.totalUsd), currency }
}

/** Any stored timestamp as epoch milliseconds, or null when unreadable. */
export function toInstantMs(value: string | null | undefined): number | null {
  const iso = normaliseXeroDate(value)
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** The date an invoice was issued: sent_at, else created_at (raw string). */
export function issuedAt(row: Pick<GoalInvoiceRow, 'sentAt' | 'createdAt'>): string | null {
  return row.sentAt || row.createdAt || null
}

/** A paid row with no readable paid date is flagged only if created this recently. */
const RECENT_UNKNOWN_DAYS = 90

export interface TwinResolution {
  /** ch_/py_ rows that duplicate an in_ row which itself records the payment. Leave out of Paid. */
  dropCharges: Set<string>
  /**
   * Owed in_ rows whose money already arrived as a paid ch_ row, mapped to that
   * charge's id. Leave out of Invoiced and older outstanding.
   */
  claimedInvoices: Map<string, string>
}

/**
 * Are these two Stripe rows the same paying party? When both rows belong to an
 * organisation that carries a Stripe customer id, the customer decides (one
 * Stripe customer can sit under several duplicate organisation records, so a
 * charge and its invoice can disagree on org_id). Otherwise fall back to the
 * organisation id.
 */
export function sameStripeParty(
  a: Pick<GoalInvoiceRow, 'orgId' | 'stripeCustomerId'>,
  b: Pick<GoalInvoiceRow, 'orgId' | 'stripeCustomerId'>,
): boolean {
  if (a.stripeCustomerId && b.stripeCustomerId) return a.stripeCustomerId === b.stripeCustomerId
  return a.orgId === b.orgId
}

/**
 * Match Stripe charge rows to in_ rows under the rule lib/stripe-dedupe.ts
 * uses (same org, amount within 0.005, same currency, 3 day window, one to
 * one, closest wins), but only against an ISSUED in_ row. Void, written off
 * and draft in_ rows are never matched, and an in_ row marked paid with no
 * paid_at is not evidence of payment, so the charge is kept.
 *
 *   in_ paid (with paid_at)  -> the ch_ is the duplicate: drop it, keep the in_.
 *   in_ owed                 -> the charge shows the money arrived: keep the
 *                               ch_ in Paid and leave the in_ out of Invoiced.
 *
 * Nothing is deleted or changed; the caller just leaves rows out.
 */
export function resolveChargeTwins(stripeRows: readonly GoalInvoiceRow[]): TwinResolution {
  const out: TwinResolution = { dropCharges: new Set(), claimedInvoices: new Map() }
  const chargeRows = stripeRows.filter(isChargeRow)
  const invoiceRows = stripeRows.filter(r =>
    isInvoiceRow(r)
    && isIssuedInvoice(r.status)
    && !(isPaidInvoice(r.status) && !r.paidAt),
  )
  if (chargeRows.length === 0 || invoiceRows.length === 0) return out
  const statusById = new Map(invoiceRows.map(r => [r.id, r.status]))
  const claimed = new Set<string>()
  const ordered = [...chargeRows].sort(
    (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id),
  )
  for (const charge of ordered) {
    // The shared matcher compares org ids and measures its window from
    // createdAt, so hand it copies: orgId set to the charge's own id when the
    // paying party matches (customer first, org as fallback), and for a PAID
    // invoice createdAt replaced by when it was paid, because a charge settles
    // a paid invoice on the day it was paid, not the day it was sent.
    const candidates = invoiceRows
      .filter(inv => sameStripeParty(charge, inv))
      .map(inv => ({
        ...inv,
        orgId: charge.orgId,
        createdAt: isPaidInvoice(inv.status) ? (normaliseXeroDate(inv.paidAt) ?? inv.createdAt) : inv.createdAt,
      }))
    const twin = findInvoiceTwin(charge, candidates, claimed)
    if (!twin) continue
    claimed.add(twin.id)
    if (isPaidInvoice(statusById.get(twin.id))) out.dropCharges.add(charge.id)
    else out.claimedInvoices.set(twin.id, charge.id)
  }
  return out
}

export interface GoalInvoiceBuckets {
  paid: MoneyItem[]
  /** Owed and unpaid, issued inside the month. */
  invoiced: MoneyItem[]
  /** Owed and unpaid, issued before the month. Never part of the bar's totals. */
  olderOutstanding: MoneyItem[]
  /** Duplicate or already-paid rows left out (dropped charges plus claimed in_ rows). */
  twinsExcluded: number
  /** Rows whose paid or issue date could not be read. They are in no bucket. */
  unknownDate: number
}

/**
 * Sort rows into the buckets. `monthStartIso` and `monthEndIso` are the half
 * open window. A row is in at most one bucket by construction: Paid needs a
 * paid status, the other two need an owed status and no paid date.
 */
export function bucketInvoices(
  rows: readonly GoalInvoiceRow[],
  twins: TwinResolution,
  monthStartIso: string,
  monthEndIso: string,
  nowMs: number = Date.now(),
): GoalInvoiceBuckets {
  const start = Date.parse(monthStartIso)
  const end = Date.parse(monthEndIso)
  const byId = new Map(rows.map(r => [r.id, r]))
  const inMonth = (ms: number | null) => ms !== null && ms >= start && ms < end
  const out: GoalInvoiceBuckets = { paid: [], invoiced: [], olderOutstanding: [], twinsExcluded: 0, unknownDate: 0 }
  for (const row of rows) {
    if (isPaidInvoice(row.status)) {
      const paid = toInstantMs(row.paidAt)
      if (paid === null) {
        // Only recent rows are worth flagging; old history would repeat forever.
        const created = toInstantMs(row.createdAt)
        if (created !== null && nowMs - created <= RECENT_UNKNOWN_DAYS * 86_400_000) out.unknownDate++
        continue
      }
      if (paid < start || paid >= end) continue
      if (twins.dropCharges.has(row.id)) out.twinsExcluded++
      else out.paid.push(goalAmount(row))
      continue
    }
    if (!isOwedInvoice(row.status) || row.paidAt) continue
    const chargeId = twins.claimedInvoices.get(row.id)
    if (chargeId !== undefined) {
      // Counted in the footnote only when it touches this month: the invoice
      // was issued in it, or its settling charge was paid in it.
      const charge = byId.get(chargeId)
      if (inMonth(toInstantMs(issuedAt(row))) || (charge && (inMonth(toInstantMs(charge.paidAt)) || inMonth(toInstantMs(charge.createdAt))))) {
        out.twinsExcluded++
      }
      continue
    }
    const issued = toInstantMs(issuedAt(row))
    if (issued === null) {
      out.unknownDate++
      continue
    }
    if (issued < start) out.olderOutstanding.push(goalAmount(row))
    else if (issued < end) out.invoiced.push(goalAmount(row))
  }
  return out
}
