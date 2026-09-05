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
 * The cap ROTATES, and that is not a detail. A candidate that can never yield
 * a link (an org with online invoicing switched off, an invoice deleted
 * between the list read and the link read) writes nothing and therefore
 * requeues on every run. With a fixed window it would sit at the head of a
 * stable list forever and hold its slot, so 25 poisoned rows would starve
 * every newly approved invoice indefinitely and `deferred` would just report a
 * constant backlog. `onlineInvoiceWindow` moves the window one cap-sized block
 * per hour instead, so a poisoned head costs one block per cycle rather than
 * the whole budget.
 *
 * Failure is never fatal. Xero rate-limits, an invoice gets voided between the
 * list read and the link read, the org has online invoicing switched off: all
 * of those leave the column NULL and the sync reports a clean result. NULL
 * means "no link yet", which is also the honest state of every draft, so the
 * surface that renders it (the client "How to pay" block, next slice) has to
 * cope with NULL regardless.
 *
 * A stored link is not permanent either. Xero revokes the online invoice the
 * moment the bill leaves AUTHORISED / PAID, which happens two ways in this
 * repo: a void or delete in Xero (mapped 'written_off'), and our own push
 * route, which re-sends Status DRAFT on an UPDATE and so demotes an invoice
 * Liam had already approved. `shouldClearOnlineInvoiceUrl` is the rule the
 * readers apply for the first; the push route nulls the column itself for the
 * second. Either way the client must never be handed a link that 404s.
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

/**
 * How long one window position lasts, in milliseconds.
 *
 * One hour, which is the sync cron's period, so consecutive runs land on
 * consecutive blocks and the whole queue is walked in ceil(candidates / cap)
 * hours. Derived from the run timestamp rather than from stored state so the
 * rotation needs no column and stays a pure function of `now`.
 */
export const ONLINE_INVOICE_ROTATION_MS = 60 * 60 * 1000

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
 * Xero statuses that map to 'sent' but have NO online invoice.
 *
 * SUBMITTED is "awaiting approval": lib/xero-status.ts maps it to 'sent'
 * because the money is owed and the distinction is internal to Xero, but Xero
 * has not issued the bill and answers the OnlineInvoice endpoint with an
 * error. Queuing one buys a guaranteed failure that requeues on every
 * subsequent run, which is exactly the poison the rotating window exists to
 * survive. Cheaper not to ask.
 */
const NO_LINK_XERO_STATUSES: ReadonlySet<string> = new Set(['SUBMITTED'])

/**
 * Does Xero have a pay link for an invoice in this state?
 *
 * Keyed off the MAPPED status so it agrees with lib/xero-status.ts by
 * construction: 'sent' is AUTHORISED or SUBMITTED and 'paid' is PAID (or a
 * settled AUTHORISED). 'draft' (DRAFT) and 'written_off' (VOIDED / DELETED)
 * have no link and asking for one is an error, so they never qualify.
 *
 * The raw Xero status is the one refinement on top of the mapping, because
 * 'sent' covers one state Xero will not serve a link for: see
 * NO_LINK_XERO_STATUSES. Omit it and only the mapping is consulted.
 *
 * A paid invoice is included deliberately. The link is still the client's
 * receipt, and a bill that settled between two runs would otherwise never get
 * one captured at all.
 */
export function hasOnlineInvoice(
  mapped: XeroMappedStatus | null,
  xeroStatus?: string | null,
): boolean {
  if (typeof xeroStatus === 'string' && NO_LINK_XERO_STATUSES.has(xeroStatus)) return false
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
  xeroStatus?: string | null,
): boolean {
  if (!hasOnlineInvoice(mapped, xeroStatus)) return false
  return typeof storedUrl !== 'string' || storedUrl.trim() === ''
}

/**
 * Should a stored link be thrown away on this reading?
 *
 * Yes when the dashboard holds a URL and Xero has moved the bill somewhere it
 * no longer serves one: DRAFT (mapped 'draft', which is also what our own push
 * route demotes an approved invoice back to) and VOIDED / DELETED (mapped
 * 'written_off'). The column was write-once until this rule existed, so a
 * voided invoice kept a link that now 404s or shows a cancelled bill, and the
 * client-facing surface that renders it would hand that to someone about to
 * move money.
 *
 * A null `mapped` means Xero had no opinion worth writing, which is never a
 * reason to throw away a good link.
 */
export function shouldClearOnlineInvoiceUrl(
  mapped: XeroMappedStatus | null,
  storedUrl: string | null | undefined,
): boolean {
  if (typeof storedUrl !== 'string' || storedUrl.trim() === '') return false
  return mapped === 'draft' || mapped === 'written_off'
}

/**
 * The slice of candidates this run is allowed to spend its budget on.
 *
 * A stable prefix would let a permanently failing head keep the whole cap on
 * every run: nothing is written on a failure, so the same rows requeue, and
 * newly approved invoices behind them would never be reached. The window walks
 * one cap-sized block per ONLINE_INVOICE_ROTATION_MS instead, wrapping, so the
 * queue is covered in ceil(candidates / cap) runs however badly the head
 * behaves.
 *
 * Pure in (candidates, cap, now): same run timestamp, same window, so the
 * behaviour is pinned by tests rather than by luck.
 */
export function onlineInvoiceWindow<T>(candidates: T[], cap: number, now: string): T[] {
  if (cap <= 0) return []
  if (candidates.length <= cap) return candidates.slice()

  const blocks = Math.ceil(candidates.length / cap)
  const parsed = Date.parse(now)
  const runs = Number.isFinite(parsed) ? Math.floor(parsed / ONLINE_INVOICE_ROTATION_MS) : 0
  const block = ((runs % blocks) + blocks) % blocks
  const start = (block * cap) % candidates.length

  const out: T[] = []
  for (let i = 0; i < cap; i++) out.push(candidates[(start + i) % candidates.length])
  return out
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

  // Rotating, not a stable prefix: see onlineInvoiceWindow. A head of rows
  // that can never yield a link must not hold the whole budget forever.
  for (const candidate of onlineInvoiceWindow(candidates, cap, now)) {
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
