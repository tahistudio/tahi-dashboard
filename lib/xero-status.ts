/**
 * lib/xero-status.ts
 *
 * The ONE Xero-to-dashboard invoice status mapping.
 *
 * Three mappings used to disagree (the 2026-09-06 invoice channel assessment):
 * the importer read SUBMITTED as 'sent', the payment sync read the same
 * SUBMITTED as 'viewed', and the webhook read it as 'sent' but also called a
 * zero balance 'paid'. The same Xero invoice therefore read differently
 * depending on which job touched it last. Everything now goes through
 * `mapXeroInvoiceStatus` below.
 *
 * The table, which is the decision, not an implementation detail:
 *
 *   Xero status   Dashboard status   Why
 *   -----------   ----------------   ----------------------------------------
 *   DRAFT         draft              Not issued. Xero has not sent it and the
 *                                    portal hides drafts from the client.
 *   SUBMITTED     sent               "Awaiting approval" is an internal Xero
 *                                    step, not a client-visible one, and the
 *                                    money is still owed. Same as AUTHORISED.
 *   AUTHORISED    sent               Issued and owed.
 *   PAID          paid               Settled.
 *   VOIDED        written_off        Cancelled after issue: the dashboard's
 *                                    word for "this will never be collected".
 *   DELETED       null               Removed before issue, so there is nothing
 *                                    to create. On a row we ALREADY hold it
 *                                    reads as 'written_off' instead, see
 *                                    mapXeroInvoiceStatusForKnownRow.
 *   anything else null               An unrecognised status is not a licence
 *                                    to overwrite a good local row.
 *
 * One refinement on top of the table: an AUTHORISED or SUBMITTED invoice whose
 * balance has reached zero AND which carries a FullyPaidOnDate is treated as
 * 'paid', because Xero occasionally lags the PAID flag behind the final
 * payment allocation. Both halves are required. A zero balance on its own also
 * describes a zero-value invoice, and IC.1 made `status = 'paid'` with a NULL
 * `paid_at` an error state (/financial-reports is keyed on paid_at), so
 * without a paid date there is nothing honest to stamp.
 *
 * The table says what Xero MEANS. What a reader is allowed to WRITE with it is
 * a second, narrower question, because the dashboard knows things Xero has not
 * been told: see NEVER_OVERWRITTEN_BY and reconcileXeroStatus below.
 *
 * Pure: no D1 handle, no fetch, so the whole table is unit testable and the
 * importer, the payment sync and the webhook cannot drift apart again.
 */

/** The dashboard statuses a Xero invoice can map onto. */
export type XeroMappedStatus = 'draft' | 'sent' | 'paid' | 'written_off'

/**
 * Which local statuses a given mapped status is NOT allowed to overwrite.
 *
 * Xero is only the authority on a bill's life where Xero is actually told
 * about it, and today it is not told about most of it. The push route sends
 * every dashboard invoice to Xero as Status DRAFT and nothing in this repo
 * ever approves one, the send-email route promotes the local row to 'sent' on
 * its own, and a hand mark-paid stamps paid_at locally without pushing back to
 * the rail (that push-back is a later slice). So for a dashboard-raised
 * invoice Xero is KNOWN to be stale, and a nightly reader that trusted it
 * would walk a paid invoice back to 'draft', where the portal hides it from
 * the client (both portal invoice routes filter status != 'draft') and
 * /financial-reports loses the revenue with it.
 *
 * The rule is therefore one-directional: Xero may move a row FORWARD, never
 * backward.
 *
 *   draft        create-only. It may fill in a row that has no status yet; it
 *                may never demote one that has already been issued or settled.
 *   sent         may promote a draft, but must not flatten 'viewed' or
 *                'overdue' (refinements of 'sent' that the dashboard learned
 *                on its own: the client opened it in the portal, or it aged
 *                past due) and must not undo 'paid' or 'written_off'.
 *   paid         terminal, always allowed. Xero seeing money is real money.
 *   written_off  terminal, always allowed. A VOIDED invoice is dead wherever
 *                the dashboard thought it was.
 *
 * When push-back lands and a locally paid invoice is actually reflected in
 * Xero, the 'sent' row here can be relaxed so an unwound payment demotes
 * again.
 */
const NEVER_OVERWRITTEN_BY: Record<XeroMappedStatus, ReadonlySet<string>> = {
  draft: new Set(['sent', 'viewed', 'overdue', 'paid', 'written_off']),
  sent: new Set(['viewed', 'overdue', 'paid', 'written_off']),
  paid: new Set(),
  written_off: new Set(),
}

/**
 * Local statuses that mean the payment did not happen, or has been undone,
 * so a stored paid_at is no longer true and must be cleared with the status.
 *
 * This is the same set as UNWINDS_PAYMENT in
 * app/api/admin/invoices/[id]/route.ts, which is the hand mark-paid path, and
 * it exists here so the three Xero readers (the importer, the payment sync and
 * the webhook) share one rule with it. A write-off is deliberately not in the
 * set: on a written-off invoice the money may well have landed, and
 * /financial-reports keys YTD revenue, 90-day collected, the tax-year totals
 * and the monthly series off paid_at rather than status, so nulling the date
 * there would erase real revenue.
 */
export const UNWINDS_PAYMENT: ReadonlySet<string> = new Set(['draft', 'sent', 'viewed', 'overdue'])

/**
 * Should a row that is locally 'paid' lose its paid date when it moves to
 * `nextStatus`? See UNWINDS_PAYMENT.
 */
export function shouldUnwindPaidAt(
  localStatus: string | null | undefined,
  nextStatus: string | null | undefined,
): boolean {
  if (localStatus !== 'paid') return false
  if (!nextStatus) return false
  return UNWINDS_PAYMENT.has(nextStatus)
}

/**
 * Map a Xero invoice status to a dashboard invoices.status value.
 *
 * @param xeroStatus      Invoice.Status straight off the Xero payload.
 * @param amountDue       Invoice.AmountDue, for the settled-balance refinement.
 * @param fullyPaidOnDate Invoice.FullyPaidOnDate, same refinement.
 * @returns the dashboard status, or null when Xero has no opinion worth
 *          writing (DELETED, or a status this mapper does not know). A null
 *          means "leave the local row alone"; the importer skips the row.
 */
export function mapXeroInvoiceStatus(
  xeroStatus: string | null | undefined,
  amountDue?: number | null,
  fullyPaidOnDate?: string | null,
): XeroMappedStatus | null {
  switch (xeroStatus) {
    case 'DRAFT':
      return 'draft'
    case 'SUBMITTED':
    case 'AUTHORISED':
      return isSettled(amountDue, fullyPaidOnDate) ? 'paid' : 'sent'
    case 'PAID':
      return 'paid'
    case 'VOIDED':
      return 'written_off'
    case 'DELETED':
      return null
    default:
      return null
  }
}

/**
 * The same table, read for a row the dashboard ALREADY holds.
 *
 * One difference: DELETED. `mapXeroInvoiceStatus` returns null so the importer
 * never CREATES a row for an invoice Xero threw away. On a row we already
 * hold, though, null means "leave it exactly as it is", and a 'sent' invoice
 * whose Xero counterpart no longer exists then sits in the client portal as
 * payable forever with nothing able to clear it: the payment sync records
 * 'not_found_in_xero' and does nothing, and the importer never sees it again.
 * Deleted in Xero is uncollectable here, which is what 'written_off' says.
 */
export function mapXeroInvoiceStatusForKnownRow(
  xeroStatus: string | null | undefined,
  amountDue?: number | null,
  fullyPaidOnDate?: string | null,
): XeroMappedStatus | null {
  if (xeroStatus === 'DELETED') return 'written_off'
  return mapXeroInvoiceStatus(xeroStatus, amountDue, fullyPaidOnDate)
}

/** Zero balance AND a paid date. Either alone is not enough (see the header). */
function isSettled(amountDue?: number | null, fullyPaidOnDate?: string | null): boolean {
  if (typeof amountDue !== 'number' || !Number.isFinite(amountDue) || amountDue > 0) return false
  return normaliseXeroDate(fullyPaidOnDate) !== null
}

/**
 * What to actually write for a row we already hold, given the mapped status.
 *
 * Returns the status to store, or null when the write should be skipped:
 * Xero had no opinion, the status already agrees, or the mapped status would
 * move the row backwards (see NEVER_OVERWRITTEN_BY, which is where the whole
 * "Xero may only move a row forward" rule lives).
 */
export function reconcileXeroStatus(
  localStatus: string | null | undefined,
  mapped: XeroMappedStatus | null,
): XeroMappedStatus | null {
  if (mapped === null) return null
  if (mapped === localStatus) return null
  if (NEVER_OVERWRITTEN_BY[mapped].has(localStatus ?? '')) return null
  return mapped
}

/** A row as the three Xero readers hold it before they write anything. */
export interface XeroLocalInvoice {
  status: string | null | undefined
  paidAt?: string | null
  sentAt?: string | null
}

/** The status-side columns a Xero read wants to change, and nothing else. */
export interface XeroStatusWrite {
  status?: XeroMappedStatus
  paidAt?: string | null
  sentAt?: string
}

/**
 * Turn a Xero reading into the status, paid date and sent date a local row
 * should carry. Shared by the importer, the payment sync and the webhook so
 * the three of them cannot drift apart on the timestamps the way they drifted
 * apart on the status itself.
 *
 * Only fields that actually change are present in the result, so a caller can
 * treat an empty object as "nothing to do" and skip the UPDATE outright.
 *
 *   status   the reconciled status (forward-only, see reconcileXeroStatus).
 *   paidAt   Xero's own FullyPaidOnDate whenever Xero says the bill is
 *            settled, because /financial-reports buckets revenue by paid_at
 *            and a payment that landed last month belongs to last month. A
 *            settled invoice with no date at all still gets `now` rather than
 *            a null, since IC.1 made paid-with-a-null-date an error state.
 *            Cleared only for the statuses in UNWINDS_PAYMENT, which today the
 *            forward-only guard never reaches from a paid row; it is the rule
 *            that takes over the moment push-back lets that guard relax.
 *   sentAt   stamped on the first promotion to 'sent', matching the first-send
 *            semantics of the PATCH route and the invoice email.
 */
export function resolveXeroStatusWrite(
  local: XeroLocalInvoice,
  mapped: XeroMappedStatus | null,
  fullyPaidOnDate: string | null | undefined,
  now: string,
): XeroStatusWrite {
  const write: XeroStatusWrite = {}
  const next = reconcileXeroStatus(local.status, mapped)
  if (next) write.status = next

  if (mapped === 'paid') {
    const settledAt = normaliseXeroDate(fullyPaidOnDate)
    if (settledAt) {
      if (settledAt !== local.paidAt) write.paidAt = settledAt
    } else if (!local.paidAt) {
      write.paidAt = now
    }
  } else if (shouldUnwindPaidAt(local.status, next)) {
    write.paidAt = null
  }

  if (next === 'sent' && !local.sentAt) write.sentAt = now

  return write
}

/**
 * Normalise a Xero date to a full ISO UTC stamp, or null when there isn't one.
 *
 * Xero hands out three shapes across its JSON payloads and the dashboard
 * stores one: `paid_at` is compared against `new Date(...).toISOString()`
 * boundaries by /financial-reports, so a bare date or a .NET epoch string
 * would silently sort wrong.
 *
 *   "/Date(1518685950940+0000)/"  .NET epoch, what FullyPaidOnDate looks like
 *   "2026-09-01T00:00:00"          Xero's date-time strings, already UTC
 *   "2026-09-01"                   date only, midnight UTC
 */
export function normaliseXeroDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const dotNet = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(trimmed)
  if (dotNet) {
    const ms = Number(dotNet[1])
    if (!Number.isFinite(ms)) return null
    return new Date(ms).toISOString()
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`
  }

  // A date-time without a zone is UTC in Xero's payloads; say so explicitly so
  // the runtime does not read it as local time.
  const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)
  const candidate = naive ? `${trimmed.replace(' ', 'T')}Z` : trimmed
  const parsed = Date.parse(candidate)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString()
}
