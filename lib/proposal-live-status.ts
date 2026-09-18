/**
 * lib/proposal-live-status.ts - which proposal statuses count as "live" on
 * the owner overview's "Proposals live" card. Pulled out of owner-home.tsx
 * so it can be unit tested on its own.
 *
 * `proposals.status` is one of: draft | shared | accepted | declined |
 * withdrawn | expired (see db/schema.ts and
 * app/(dashboard)/proposals/proposals-content.tsx). A draft has never left
 * the studio, so it is not "live" in front of a client; shared and accepted
 * are the two states where a client has, or has had, eyes on it. `published`
 * is kept in the live set for forward compatibility even though it is not a
 * status value today (publishing snapshots the content without changing
 * status), so this helper does not silently stop matching if that ever
 * changes.
 */

const LIVE_PROPOSAL_STATUSES = new Set(['shared', 'published', 'accepted'])

export function isProposalLiveStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && LIVE_PROPOSAL_STATUSES.has(status)
}
