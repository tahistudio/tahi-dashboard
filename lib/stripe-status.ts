/**
 * lib/stripe-status.ts
 *
 * The Stripe-to-dashboard invoice status decision, mirroring the rule
 * `lib/xero-status.ts` already enforces for Xero (see NEVER_OVERWRITTEN_BY
 * there).
 *
 * A dummy Stripe invoice (customer "test manual", NZ$350, left open in
 * Stripe) was written off locally. The next morning the Stripe sync cron
 * (app/api/admin/cron/sync-stripe/route.ts, via lib/stripe-import.ts) read
 * the still-open Stripe invoice and flipped the local status straight back
 * to 'sent', so a dead invoice reappeared on the daily brief. The import had
 * no notion that a local write-off, or a local paid, should never be walked
 * backwards by a Stripe read.
 *
 * Pure: no D1 handle, no fetch, so the whole decision is unit testable and
 * the importer and the webhook self-heal (app/api/webhooks/stripe/route.ts)
 * cannot drift apart on it.
 */

/** The dashboard statuses a Stripe invoice status can map onto. */
export type StripeMappedStatus = 'draft' | 'sent' | 'paid' | 'written_off'

/**
 * Map a raw Stripe invoice status to a dashboard invoices.status value.
 *
 * Stripe's own vocabulary: draft, open, paid, void, uncollectible. Anything
 * else (or missing) falls back to 'draft', matching the original behaviour
 * in lib/stripe-import.ts before this file existed.
 */
export function mapStripeStatus(status: string | null | undefined): StripeMappedStatus {
  switch (status) {
    case 'draft': return 'draft'
    case 'open': return 'sent'
    case 'paid': return 'paid'
    case 'void': return 'written_off'
    case 'uncollectible': return 'written_off'
    default: return 'draft'
  }
}

/**
 * Which local statuses a given mapped Stripe status is NOT allowed to
 * overwrite. Mirrors NEVER_OVERWRITTEN_BY in lib/xero-status.ts:
 *
 *   draft        create-only. May fill in a row with no status yet; may
 *                never demote one already issued or settled.
 *   sent         may promote a draft, but must not flatten 'viewed',
 *                'overdue' or 'pending' (local-only refinements Stripe has
 *                no opinion on) and must not undo 'paid' or 'written_off'.
 *   paid         terminal, always allowed. Stripe seeing money is real
 *                money, even over a local write-off.
 *   written_off  terminal, but may not overwrite a local 'paid'. A void or
 *                uncollectible in Stripe says Stripe gave up on the bill;
 *                it does not say the money never came some other way (a
 *                hand mark-paid, a bank transfer). The dashboard keeps
 *                'paid' and its paid_at. Every other local status still
 *                yields to a void or uncollectible reading.
 */
const NEVER_OVERWRITTEN_BY: Record<StripeMappedStatus, ReadonlySet<string>> = {
  draft: new Set(['sent', 'viewed', 'overdue', 'pending', 'paid', 'written_off']),
  sent: new Set(['viewed', 'overdue', 'pending', 'paid', 'written_off']),
  paid: new Set(),
  written_off: new Set(['paid']),
}

/**
 * Decide what a Stripe read should write to invoices.status for a row the
 * dashboard already holds.
 *
 * @param localStatus  The invoice's current local status.
 * @param stripeStatus The raw Stripe invoice status straight off the payload.
 * @returns the status to write, or null when nothing should be written:
 *          the mapped status already agrees with the local one, or writing
 *          it would move the row backwards (see NEVER_OVERWRITTEN_BY).
 *          A null means "leave invoices.status alone"; the caller may still
 *          refresh other columns (paid_at, the hosted pay link) on the same
 *          row.
 */
export function decideStripeStatus(
  localStatus: string | null | undefined,
  stripeStatus: string | null | undefined,
): StripeMappedStatus | null {
  const mapped = mapStripeStatus(stripeStatus)
  if (mapped === localStatus) return null
  if (NEVER_OVERWRITTEN_BY[mapped].has(localStatus ?? '')) return null
  return mapped
}
