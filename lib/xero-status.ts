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
 *   DELETED       null               Removed before issue. There is no local
 *                                    status for it, so the caller leaves the
 *                                    row exactly as it is (and the importer
 *                                    never creates one).
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
 * Pure: no D1 handle, no fetch, so the whole table is unit testable and the
 * importer, the payment sync and the webhook cannot drift apart again.
 */

/** The dashboard statuses a Xero invoice can map onto. */
export type XeroMappedStatus = 'draft' | 'sent' | 'paid' | 'written_off'

/**
 * Local statuses that mean "issued and owed", i.e. refinements of 'sent' that
 * the dashboard learned on its own and Xero cannot know about: 'viewed' is
 * stamped when the client first opens the invoice in the portal, 'overdue' is
 * stamped when the bill ages past its due date. Xero reporting AUTHORISED must
 * not demote either back to plain 'sent'.
 */
const SENT_REFINEMENTS = new Set(['viewed', 'overdue'])

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

/** Zero balance AND a paid date. Either alone is not enough (see the header). */
function isSettled(amountDue?: number | null, fullyPaidOnDate?: string | null): boolean {
  if (typeof amountDue !== 'number' || !Number.isFinite(amountDue) || amountDue > 0) return false
  return normaliseXeroDate(fullyPaidOnDate) !== null
}

/**
 * What to actually write for a row we already hold, given the mapped status.
 *
 * Returns the status to store, or null when the write should be skipped:
 * Xero had no opinion, the status already agrees, or the local row carries a
 * refinement of 'sent' that Xero cannot see (see SENT_REFINEMENTS). Keeps the
 * payment sync and the importer from flattening 'viewed' and 'overdue' back to
 * 'sent' on every run now that both of them update rows instead of skipping.
 */
export function reconcileXeroStatus(
  localStatus: string | null | undefined,
  mapped: XeroMappedStatus | null,
): XeroMappedStatus | null {
  if (mapped === null) return null
  if (mapped === localStatus) return null
  if (mapped === 'sent' && SENT_REFINEMENTS.has(localStatus ?? '')) return null
  return mapped
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
