/**
 * lib/invoice-status.ts
 *
 * The ONE vocabulary for what an invoice's status MEANS to a number.
 *
 * Every money figure in the dashboard used to carry its own hand-rolled list.
 * /api/admin/overview counted sent and overdue as owed, the invoice aging
 * report counted sent alone (so a bill the client had opened stopped ageing),
 * /api/admin/billing/financial-health summed EVERY row into "total invoiced",
 * and the client Revenue tab did the same. Four readings of one ledger, and
 * the last two quietly answered the question this file exists for: a DRAFT
 * invoice was money.
 *
 * A draft is not money. Liam raises drafts in Xero as placeholders for work
 * that will be billed later, and as tests. Xero has not sent them, the client
 * cannot see them (both portal invoice routes exclude drafts), and nobody has
 * been asked to pay. So a draft must never land in owed, outstanding,
 * receivable, overdue, unpaid, aging, expected cash, MRR or revenue. It is
 * still the studio's own working copy, so it stays visible to the studio,
 * labelled, and counted under its own heading.
 *
 * The four buckets, which are the decision, not an implementation detail:
 *
 *   DRAFT   draft                  Not issued. Visible to the studio only, and
 *                                  never part of any money total.
 *   OWED    sent, viewed, overdue, Issued and unpaid. THIS is "money owed".
 *           pending                `viewed` is a read receipt on a `sent`
 *                                  invoice, not a different kind of debt, and
 *                                  `overdue` is `sent` past its due date.
 *                                  `pending` is the ManyRequests word, which
 *                                  lib/import/manyrequests/map.ts folds to
 *                                  'sent' but which older rows may still hold.
 *   PAID    paid                   Settled. Revenue.
 *   VOID    written_off, void,     Dead. Never collected and never will be, so
 *           voided, cancelled,     not owed AND not revenue. Only
 *           refunded               `written_off` is written here; the rest are
 *                                  words a Xero or Stripe import could hand us
 *                                  and cost nothing to name.
 *
 * Pure, dependency-free, and safe in the browser as well as on the worker, so
 * an API route and the tile it feeds cannot disagree about what a status is.
 */

// ── The buckets ──────────────────────────────────────────────────────────────

/** Not issued to anyone. Never money. */
export const DRAFT_STATUSES = ['draft'] as const

/**
 * Issued and unpaid: the set every "owed" / "outstanding" / "receivable" /
 * "aging" / "expected cash" figure counts, and nothing else.
 */
export const OWED_STATUSES = ['sent', 'viewed', 'overdue', 'pending'] as const

/** Settled. The set every revenue and collected figure counts. */
export const PAID_STATUSES = ['paid'] as const

/** Dead: written off, voided, cancelled or refunded. Neither owed nor revenue. */
export const VOID_STATUSES = ['written_off', 'void', 'voided', 'cancelled', 'refunded'] as const

export type DraftInvoiceStatus = (typeof DRAFT_STATUSES)[number]
export type OwedInvoiceStatus = (typeof OWED_STATUSES)[number]
export type PaidInvoiceStatus = (typeof PAID_STATUSES)[number]
export type VoidInvoiceStatus = (typeof VOID_STATUSES)[number]

const DRAFT_SET: ReadonlySet<string> = new Set(DRAFT_STATUSES)
const OWED_SET: ReadonlySet<string> = new Set(OWED_STATUSES)
const PAID_SET: ReadonlySet<string> = new Set(PAID_STATUSES)
const VOID_SET: ReadonlySet<string> = new Set(VOID_STATUSES)

/**
 * Trim and lower-case a stored status before it is compared.
 *
 * `invoices.status` is untyped TEXT and three importers write it, so a stray
 * "Draft" or " paid " must not slip past a bucket test and become money.
 */
export function normaliseInvoiceStatus(status: unknown): string {
  return typeof status === 'string' ? status.trim().toLowerCase() : ''
}

// ── The predicates ───────────────────────────────────────────────────────────

/** The studio's working copy. Visible to the studio, never counted as money. */
export function isDraftInvoice(status: unknown): boolean {
  return DRAFT_SET.has(normaliseInvoiceStatus(status))
}

/** Issued and still unpaid. The only thing "money owed" may ever mean. */
export function isOwedInvoice(status: unknown): boolean {
  return OWED_SET.has(normaliseInvoiceStatus(status))
}

/** Settled. */
export function isPaidInvoice(status: unknown): boolean {
  return PAID_SET.has(normaliseInvoiceStatus(status))
}

/** Written off, voided, cancelled or refunded. */
export function isVoidInvoice(status: unknown): boolean {
  return VOID_SET.has(normaliseInvoiceStatus(status))
}

/**
 * Has this bill actually been issued and is it still live: owed or paid.
 *
 * The honest denominator for "total invoiced" and for the 90-day cash
 * conversion ratio. A draft was never issued, and a voided invoice was
 * un-issued, so counting either one deflates the ratio against work that was
 * never billed.
 */
export function isIssuedInvoice(status: unknown): boolean {
  return isOwedInvoice(status) || isPaidInvoice(status)
}

// ── Drizzle-friendly lists ───────────────────────────────────────────────────
//
// `inArray()` wants a mutable array, and a shared exported array could be
// sorted or pushed to by a caller, so these hand out a fresh copy each time.

/** For `inArray(schema.invoices.status, owedStatusList())`. */
export function owedStatusList(): string[] {
  return [...OWED_STATUSES]
}

/** For `inArray(schema.invoices.status, draftStatusList())`. */
export function draftStatusList(): string[] {
  return [...DRAFT_STATUSES]
}

/** For `inArray(schema.invoices.status, paidStatusList())`. */
export function paidStatusList(): string[] {
  return [...PAID_STATUSES]
}

/** For `inArray(schema.invoices.status, issuedStatusList())`. */
export function issuedStatusList(): string[] {
  return [...OWED_STATUSES, ...PAID_STATUSES]
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export interface InvoiceStatusPartition<T> {
  drafts: T[]
  owed: T[]
  paid: T[]
  voided: T[]
  /** A status none of the four buckets recognises. Never counted as money. */
  unknown: T[]
}

/**
 * Split a loaded list of invoices into the four buckets in one pass.
 *
 * Used by every surface that shows tiles (the client Invoices tab, the client
 * Revenue tab, the invoices list), so "Outstanding", "Paid" and "Drafts" on
 * one screen are always drawn from the same partition and cannot double-count
 * a row or silently drop one.
 */
export function partitionInvoicesByStatus<T extends { status: string }>(
  rows: readonly T[],
): InvoiceStatusPartition<T> {
  const out: InvoiceStatusPartition<T> = { drafts: [], owed: [], paid: [], voided: [], unknown: [] }
  for (const row of rows) {
    if (isDraftInvoice(row.status)) out.drafts.push(row)
    else if (isOwedInvoice(row.status)) out.owed.push(row)
    else if (isPaidInvoice(row.status)) out.paid.push(row)
    else if (isVoidInvoice(row.status)) out.voided.push(row)
    else out.unknown.push(row)
  }
  return out
}

/**
 * The "N drafts, NZ$X not yet issued" figure, for the studio surfaces that
 * show drafts on their own line beside owed rather than inside it.
 *
 * `amountOf` converts each row to whatever the caller is displaying (NZD via
 * the rate map on the server, native on a per-currency tile), so this helper
 * never has an opinion about currency.
 */
export function draftInvoiceTotal<T extends { status: string }>(
  rows: readonly T[],
  amountOf: (row: T) => number,
): { count: number; total: number } {
  let count = 0
  let total = 0
  for (const row of rows) {
    if (!isDraftInvoice(row.status)) continue
    count += 1
    total += amountOf(row)
  }
  return { count, total }
}
