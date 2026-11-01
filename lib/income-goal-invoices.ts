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
 *   - Stripe       amount = total = the Stripe figure, which includes any tax
 *                  Stripe collected. There is no ex-tax figure to subtract, so
 *                  a Stripe NZD invoice with Stripe-collected GST would still
 *                  count GST. The studio's NZD invoices are raised through
 *                  Xero, so this is expected to be rare.
 * tax_amount_usd is NOT reliable (INV-0071 has amount 3000, total 3450, tax 0),
 * so GST is never derived from it. For NZD rows the figure used is
 * amount minus discount, floored at 0, which is ex-GST for every source above.
 * Non-NZD rows use total, unchanged, because tax treatment there is unknown.
 */

import {
  findInvoiceTwin,
  isChargeRow,
  isInvoiceRow,
  type InvoiceRowLike,
} from '@/lib/stripe-dedupe'
import { isOwedInvoice, isPaidInvoice } from '@/lib/invoice-status'
import type { MoneyItem } from '@/lib/income-goal'

export interface GoalInvoiceRow extends InvoiceRowLike {
  status: string
  amountUsd: number
  discountAmountUsd: number | null
  sentAt: string | null
}

/** The amount a row contributes: ex-GST for NZD, the total otherwise. */
export function goalAmount(row: Pick<GoalInvoiceRow, 'currency' | 'amountUsd' | 'discountAmountUsd' | 'totalUsd'>): MoneyItem {
  const currency = (row.currency ?? '').trim().toUpperCase() || 'NZD'
  if (currency === 'NZD') {
    const net = (row.amountUsd ?? 0) - (row.discountAmountUsd ?? 0)
    return { amount: Math.max(0, net), currency }
  }
  return { amount: row.totalUsd, currency }
}

/**
 * Ids of Stripe charge rows (ch_ or py_) that duplicate an in_ invoice row,
 * under exactly the rule the cleanup route uses. Nothing is deleted or changed;
 * the caller just leaves these rows out. Needs EVERY stripe-source row, not
 * only the ones in the month, because the twin can sit in an earlier window.
 */
export function chargeTwinIds(stripeRows: readonly GoalInvoiceRow[]): Set<string> {
  const chargeRows = stripeRows.filter(isChargeRow)
  const invoiceRows = stripeRows.filter(isInvoiceRow)
  const twins = new Set<string>()
  if (chargeRows.length === 0 || invoiceRows.length === 0) return twins
  const claimed = new Set<string>()
  const ordered = [...chargeRows].sort(
    (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id),
  )
  for (const charge of ordered) {
    const twin = findInvoiceTwin(charge, invoiceRows, claimed)
    if (twin) {
      claimed.add(twin.id)
      twins.add(charge.id)
    }
  }
  return twins
}

export interface GoalInvoiceBuckets {
  paid: MoneyItem[]
  /** Owed and unpaid, issued inside the month. */
  invoiced: MoneyItem[]
  /** Owed and unpaid, issued before the month. Never part of the bar's totals. */
  olderOutstanding: MoneyItem[]
  twinsExcluded: number
}

/** The date an invoice was issued: sent_at, else created_at. */
export function issuedAt(row: Pick<GoalInvoiceRow, 'sentAt' | 'createdAt'>): string | null {
  return row.sentAt || row.createdAt || null
}

/**
 * Sort rows into the buckets. `rows` is every invoice that could matter
 * (paid in the month, or still owed); `monthStartIso` and `monthEndIso` are
 * the half open window. A row is in at most one bucket by construction: Paid
 * needs a paid status and a paid_at inside the window, the other two need an
 * owed status and no paid_at.
 */
export function bucketInvoices(
  rows: readonly GoalInvoiceRow[],
  twins: ReadonlySet<string>,
  monthStartIso: string,
  monthEndIso: string,
): GoalInvoiceBuckets {
  const out: GoalInvoiceBuckets = { paid: [], invoiced: [], olderOutstanding: [], twinsExcluded: 0 }
  for (const row of rows) {
    const paidAt = row.paidAt ?? null
    if (isPaidInvoice(row.status)) {
      if (paidAt && paidAt >= monthStartIso && paidAt < monthEndIso) {
        if (twins.has(row.id)) out.twinsExcluded++
        else out.paid.push(goalAmount(row))
      }
      continue
    }
    if (!isOwedInvoice(row.status) || paidAt) continue
    if (twins.has(row.id)) {
      out.twinsExcluded++
      continue
    }
    const issued = issuedAt(row)
    if (!issued) continue
    if (issued < monthStartIso) out.olderOutstanding.push(goalAmount(row))
    else if (issued < monthEndIso) out.invoiced.push(goalAmount(row))
  }
  return out
}

