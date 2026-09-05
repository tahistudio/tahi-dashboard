/**
 * lib/xero-online-invoice.ts
 *
 * Capturing Xero's own pay link, the OnlineInvoiceUrl.
 *
 * A Xero-rail client never sees a Stripe hosted page. What they get is Xero's
 * online invoice: the page Xero itself serves, carrying the PDF and whatever
 * pay-now methods the org has switched on. The dashboard has to hold that URL
 * to show the client anything to click, and until this slice the string
 * appeared nowhere in the repo.
 *
 * The awkward part, and the reason this is its own module rather than four
 * lines inside a sync:
 *
 *   - Xero only issues an OnlineInvoiceUrl for an AUTHORISED or PAID ACCREC
 *     invoice. GET /Invoices/{id}/OnlineInvoice ERRORS on a DRAFT.
 *   - The push route sends every dashboard invoice to Xero as DRAFT and keeps
 *     doing so on purpose (Liam, 2026-09-06: auto-approve is a later setting).
 *     So at push time there is nothing to capture, ever.
 *   - The link therefore appears out of band, the moment Liam approves the
 *     invoice inside Xero, and the only things that look at Xero afterwards
 *     are the two nightly readers in lib/xero-sync.ts.
 *
 * Hence: the readers capture it, not the writer. One extra GET per invoice,
 * once in its life (the column is written once and never re-fetched), and only
 * for invoices Xero has actually issued. A run is capped so a first sync over
 * a ledger of 400 approved invoices makes 25 extra calls, not 400, and does
 * not spend the whole Xero rate limit on links. The rest are picked up by the
 * following runs; the cron is hourly, so a backlog drains the same day.
 *
 * Failure is never fatal. Xero rate-limits, an invoice gets voided between the
 * list read and the link read, the org has online invoicing switched off: all
 * of those leave the column NULL and the sync reports a clean result. NULL
 * means "no link yet", which is also the honest state of every draft, so the
 * surface that renders it (the client "How to pay" block, next slice) has to
 * cope with NULL regardless.
 */

import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'
import type { XeroMappedStatus } from '@/lib/xero-status'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * How many OnlineInvoice fetches one sync run is allowed to make.
 *
 * Small on purpose. This is an EXTRA call per invoice on top of the paged list
 * the sync already walks, it only ever runs once per invoice, and a backlog
 * drains across the following runs of an hourly cron rather than blocking one
 * of them behind hundreds of round trips.
 */
export const ONLINE_INVOICE_FETCH_CAP = 25

/** A local row that is missing its Xero pay link and might now have one. */
export interface OnlineInvoiceCandidate {
  /** Local invoices.id, the row the URL is written to. */
  id: string
  /** invoices.xero_invoice_id, the id Xero is asked about. */
  xeroInvoiceId: string
}

/** What one capture pass did, for the sync summary. */
export interface OnlineInvoiceCapture {
  /** Candidates the pass saw, before the cap. */
  candidates: number
  /** OnlineInvoice calls actually made. */
  fetched: number
  /** Rows that gained a URL. */
  captured: number
  /** Calls that came back with nothing usable. Tolerated, column stays NULL. */
  failed: number
  /** Candidates left for the next run because the cap was reached. */
  deferred: number
}

/** Xero's answer to GET /Invoices/{id}/OnlineInvoice. */
interface XeroOnlineInvoiceResponse {
  OnlineInvoices?: Array<{ OnlineInvoiceUrl?: string }>
}

/**
 * Does Xero have a pay link for an invoice in this state?
 *
 * Keyed off the MAPPED status rather than the raw Xero string so it agrees
 * with lib/xero-status.ts by construction: 'sent' is AUTHORISED or SUBMITTED
 * and 'paid' is PAID (or a settled AUTHORISED), which is exactly the set Xero
 * issues an online invoice for. 'draft' (DRAFT) and 'written_off' (VOIDED /
 * DELETED) have no link and asking for one is an error, so they never do.
 *
 * A paid invoice is included deliberately. The link is still the client's
 * receipt, and a bill that settled between two runs would otherwise never get
 * one captured at all.
 */
export function hasOnlineInvoice(mapped: XeroMappedStatus | null): boolean {
  return mapped === 'sent' || mapped === 'paid'
}

/**
 * Should this row be queued for a fetch? Only when Xero has issued a link and
 * the column is still empty. The column is written once, so a row that already
 * carries a URL is never asked again.
 */
export function needsOnlineInvoiceUrl(
  mapped: XeroMappedStatus | null,
  storedUrl: string | null | undefined,
): boolean {
  if (!hasOnlineInvoice(mapped)) return false
  return typeof storedUrl !== 'string' || storedUrl.trim() === ''
}

/**
 * Pull the URL out of whatever Xero answered, or null.
 *
 * Xero answers { OnlineInvoices: [{ OnlineInvoiceUrl }] }, but a failed call
 * arrives here as null (callXeroAPI swallows errors), and an org with online
 * invoicing switched off answers with an empty array. All of those are "no
 * link", not a crash.
 */
export function readOnlineInvoiceUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const list = (payload as XeroOnlineInvoiceResponse).OnlineInvoices
  if (!Array.isArray(list)) return null
  for (const entry of list) {
    const url = entry?.OnlineInvoiceUrl
    if (typeof url === 'string' && url.trim() !== '') return url.trim()
  }
  return null
}

/**
 * Fetch and store the Xero pay link for up to `cap` of the given candidates.
 *
 * Never throws: every fetch and every write is wrapped, and a failure only
 * costs that one row its link. The caller reports the counts and carries on.
 *
 * @param database  live Drizzle D1 handle.
 * @param candidates rows that want a link, in the order the sync found them.
 * @param now       the run timestamp, so updated_at matches the sync's own.
 * @param opts.cap  override the per-run ceiling (tests).
 * @param opts.fetchOnlineInvoice injected Xero reader (tests), defaults to the
 *                  real GET /Invoices/{id}/OnlineInvoice.
 */
export async function captureOnlineInvoiceUrls(
  database: D1,
  candidates: OnlineInvoiceCandidate[],
  now: string,
  opts: {
    cap?: number
    fetchOnlineInvoice?: (xeroInvoiceId: string) => Promise<unknown>
  } = {},
): Promise<OnlineInvoiceCapture> {
  const cap = opts.cap ?? ONLINE_INVOICE_FETCH_CAP
  const fetchOne = opts.fetchOnlineInvoice
    ?? ((xeroInvoiceId: string) =>
      callXeroAPI<XeroOnlineInvoiceResponse>('GET', `/Invoices/${xeroInvoiceId}/OnlineInvoice`))

  const result: OnlineInvoiceCapture = {
    candidates: candidates.length,
    fetched: 0,
    captured: 0,
    failed: 0,
    deferred: Math.max(0, candidates.length - Math.max(0, cap)),
  }

  if (cap <= 0) return result

  for (const candidate of candidates.slice(0, cap)) {
    result.fetched++
    let url: string | null = null
    try {
      url = readOnlineInvoiceUrl(await fetchOne(candidate.xeroInvoiceId))
    } catch {
      url = null
    }

    if (!url) {
      result.failed++
      continue
    }

    try {
      await database
        .update(schema.invoices)
        .set({ xeroOnlineInvoiceUrl: url, updatedAt: now })
        .where(eq(schema.invoices.id, candidate.id))
      result.captured++
    } catch {
      // A write that lost is the same as a fetch that lost: the column stays
      // NULL and the next run tries again.
      result.failed++
    }
  }

  return result
}
