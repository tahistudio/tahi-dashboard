/**
 * lib/request-review.ts
 *
 * The client-review decision domain, shared by the portal review route and
 * the client review bar on the request detail page. Pure functions only so
 * the mapping between a client's decision and the resulting request status
 * is unit-tested in one place and can never drift between the button label
 * and what the server actually writes.
 *
 * Approve  -> delivered   (the delivery is signed off, request closes)
 * Changes  -> in_progress (the request goes back to the studio's queue)
 */

export type ReviewDecision = 'approve' | 'changes'

/** The only status a client is allowed to review from. */
export const REVIEWABLE_STATUS = 'client_review'

/** Longest note we accept. Anything past this is truncated, not rejected. */
export const REVIEW_NOTE_LIMIT = 4000

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return value === 'approve' || value === 'changes'
}

/** True when a request in this status can be reviewed by the client. */
export function canReview(status: string): boolean {
  return status === REVIEWABLE_STATUS
}

/** The status a decision moves the request to. */
export function reviewDecisionToStatus(decision: ReviewDecision): 'delivered' | 'in_progress' {
  return decision === 'approve' ? 'delivered' : 'in_progress'
}

/** Toast / notification copy for a decision. */
export function reviewDecisionLabel(decision: ReviewDecision): string {
  return decision === 'approve' ? 'Approved this delivery' : 'Requested changes'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * The message body posted to the thread on the client's behalf. Always
 * carries a bold heading so the studio can spot the decision in the thread,
 * then the client's own note as escaped paragraphs. Returns heading-only
 * HTML when there is no note.
 */
export function buildReviewMessageHtml(decision: ReviewDecision, note?: string | null): string {
  const heading = `<p><strong>${reviewDecisionLabel(decision)}</strong></p>`
  const trimmed = (note ?? '').trim().slice(0, REVIEW_NOTE_LIMIT)
  if (!trimmed) return heading
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `${heading}${paragraphs}`
}
