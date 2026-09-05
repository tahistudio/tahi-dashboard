/**
 * lib/client-home-signals.ts
 *
 * The pure truth layer behind the client portal home
 * (components/tahi/overview/homes/client-home.tsx).
 *
 * Two kinds of question live here, both of which the home used to answer
 * wrongly:
 *
 *   1. What does a status MEAN to a client? The home counted
 *      ['client_review', 'delivered'] as "waiting on you" over a list fetched
 *      with ?status=active, and that route only excludes 'archived'. So every
 *      request the client had ever approved stayed in the prompt forever, and
 *      approving one moved it from client_review to delivered without the
 *      counter ever dropping. delivered is the TERMINAL state that
 *      POST /api/portal/requests/[id]/review writes on "approve" (see
 *      lib/request-review.ts) and the closed set the POST on
 *      /api/portal/requests refuses to re-queue. It is done, not pending.
 *
 *   2. Where does a row GO? Rows on the home routed to the list they came
 *      from, so pressing Pay on a specific invoice, or a specific request, or
 *      a specific file, landed the client on a page they then had to search.
 *      Each resolver below returns the item's own destination and only falls
 *      back to a list when there is genuinely no item to open.
 *
 * Pure and dependency-free on purpose: no React, no fetch, no DOM, so the
 * arithmetic that drives the primary client surface is unit-testable. The one
 * import is another pure status module, so the vocabulary has a single owner.
 */

import { REVIEWABLE_STATUS } from '@/lib/request-review'

/**
 * The one request status that is genuinely waiting on the client. Re-exported
 * from lib/request-review.ts rather than redeclared: that module is the one
 * that decides what a client may review and what approving writes, and a
 * second copy of the slug here is exactly the drift lib/status-config.ts warns
 * about. The alias exists so this module reads in the home's own vocabulary.
 */
export { REVIEWABLE_STATUS as CLIENT_REVIEW_STATUS }

/** Terminal state after the client approves a delivery. Done, not pending. */
export const CLIENT_DELIVERED_STATUS = 'delivered'

/**
 * Statuses where the studio, not the client, still holds the work.
 *
 * Deliberately WIDER than CLIENT_ACTIVE_STATUSES in lib/requests-views.ts,
 * which drives the /requests "In progress" saved view: this list adds
 * 'on_hold'. A vital labelled "Open requests" is a count of everything still
 * open on the client's account, and a paused request is still open work the
 * studio owes them; hiding it would make the home under-report. The saved view
 * is a narrower reading on purpose ("what is moving right now"). If the two are
 * ever meant to agree, change them together.
 */
export const CLIENT_OPEN_STATUSES: readonly string[] = [
  'submitted',
  'in_review',
  'in_progress',
  'on_hold',
]

/** True only when the request is sitting in the client's court. */
export function needsClientReview(status: string): boolean {
  return status === REVIEWABLE_STATUS
}

/** True while the studio is still moving the request along. */
export function isOpenForClient(status: string): boolean {
  return CLIENT_OPEN_STATUSES.includes(status)
}

/** True once the client has approved the delivery. */
export function isDeliveredForClient(status: string): boolean {
  return status === CLIENT_DELIVERED_STATUS
}

/** Minimum shape the buckets need. Real rows carry far more. */
export interface ClientRequestLike {
  status: string
}

export interface ClientRequestBuckets<T> {
  /** Waiting on the client. Drives the hero figure and the review prompt. */
  review: T[]
  /** Waiting on the studio. Drives "Open requests" and "Next delivery". */
  open: T[]
  /** Approved and closed. A quiet reading, never a call to action. */
  delivered: T[]
}

/**
 * Split a client's requests into the three readings the home shows. Cancelled,
 * archived and draft rows fall into none of them: they are not work in flight,
 * not waiting on anyone, and not something the client approved. Order inside
 * each bucket follows the incoming order.
 */
export function partitionClientRequests<T extends ClientRequestLike>(
  rows: readonly T[],
): ClientRequestBuckets<T> {
  const review: T[] = []
  const open: T[] = []
  const delivered: T[] = []
  for (const row of rows) {
    if (needsClientReview(row.status)) review.push(row)
    else if (isOpenForClient(row.status)) open.push(row)
    else if (isDeliveredForClient(row.status)) delivered.push(row)
  }
  return { review, open, delivered }
}

/**
 * Where a home row should send the client. `new_tab` is a URL to open with
 * window.open (a hosted payment page, a served file); `route` is a logical id
 * for the Overview switcher's go(), which maps ids to real dashboard paths and
 * otherwise falls through to /<id>.
 */
export type HomeDestination =
  | { kind: 'new_tab'; url: string }
  | { kind: 'route'; routeId: string }

/** Absolute http(s) only: rules out javascript:, data: and protocol-relative. */
function isSafeExternalUrl(value: string): boolean {
  return /^https?:\/\/[^/]/i.test(value)
}

/**
 * In-app absolute path only: one leading slash, no scheme, no host. The second
 * character matters as much as the first. '//host' is protocol-relative, and
 * browsers normalise a backslash to a forward slash for special schemes, so
 * '/\host' resolves off-site too. Both are rejected.
 */
function isSafeAppPath(value: string): boolean {
  return /^\/(?![/\\])/.test(value)
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Build a route id that lands on one item, encoding the id so a stray slash
 * cannot rewrite the path. Falls back to the bare list only when there is no
 * item to open at all.
 */
function itemRouteId(base: string, id: string | null | undefined): string {
  const clean = trimmed(id)
  return clean ? `${base}/${encodeURIComponent(clean)}` : base
}

export interface InvoicePayLike {
  id: string
  /** Stripe's hosted invoice page, persisted at finalise time. */
  payUrl?: string | null
}

/**
 * The Pay button's real destination: the hosted payment page when Stripe gave
 * us one, otherwise the invoice's own detail page (which has a portal branch
 * and its own Pay CTA). Never the invoice list, which is where a client with
 * one overdue bill used to land.
 */
export function invoicePayDestination(invoice: InvoicePayLike): HomeDestination {
  const url = trimmed(invoice.payUrl)
  if (url && isSafeExternalUrl(url)) return { kind: 'new_tab', url }
  return { kind: 'route', routeId: itemRouteId('invoices', invoice.id) }
}

export interface FileOpenLike {
  /** Served R2 path from /api/portal/files, e.g. /api/uploads/serve?key=... */
  url?: string | null
}

/**
 * A Recent files row opens the file itself. Falls back to the files browser
 * when the route did not hand us a path.
 */
export function fileOpenDestination(file: FileOpenLike): HomeDestination {
  const url = trimmed(file.url)
  if (url && isSafeAppPath(url)) return { kind: 'new_tab', url }
  return { kind: 'route', routeId: 'files' }
}

/**
 * An admin-set outbound link (today: organisations.onboardingLoomUrl, the
 * welcome video on the first-run panel), resolved through the same http/https
 * gate as every other outbound URL on the client home. Returns null when the
 * value is missing or is not a plain absolute web link, so the caller can hide
 * the affordance rather than open something it has not checked.
 */
export function externalLinkDestination(url: string | null | undefined): HomeDestination | null {
  const clean = trimmed(url)
  return clean && isSafeExternalUrl(clean) ? { kind: 'new_tab', url: clean } : null
}

/** Route id for a single request, so a Recent requests row opens that request. */
export function requestRouteId(requestId: string | null | undefined): string {
  return itemRouteId('requests', requestId)
}
