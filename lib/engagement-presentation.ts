/**
 * lib/engagement-presentation.ts
 *
 * What the client portal home shows in its "Your work" zone: the phased
 * ProjectBoard, or the retainer TrackBoard.
 *
 * Before this, `/api/portal/subscription` decided the answer from a single
 * signal: no active subscription row => 'project'. That conflates two
 * different things. `organisations.planType` carries a 'custom' value (see
 * lib/plan-type.ts) for a client on a NEGOTIATED PRICE, which says nothing
 * about whether their engagement is a one-off project or a retainer. A
 * custom-priced retainer client whose subscription has not been provisioned
 * yet was shown "Your project, phase by phase" and a KPI reading "Project
 * progress / Getting started", language for an engagement that was never
 * sold to them.
 *
 * The honest signal is the engagement itself:
 *   - an active subscription is a retainer, full stop (a client who has since
 *     converted to retainer does not get old project history put back in
 *     front of them, matching /api/portal/project's own priority)
 *   - with no active subscription, a real projects row or a schedule the
 *     studio has published to this client (`projectSchedules.status ===
 *     'shared'`, the same signal /api/portal/project reads) means the
 *     engagement genuinely is a project
 *   - with no active subscription and no project signal, the client is a
 *     retainer whose plan has not been provisioned yet: TrackBoard's own
 *     empty state already says so without any project language, so this
 *     resolves to 'retainer' with no track count rather than inventing one.
 *
 * Pure and DB-agnostic on purpose: the route reads the three booleans off D1
 * and hands them here, so the decision itself is one thing every caller and
 * every test can agree on.
 */

export interface EngagementSignals {
  /** An active subscriptions row exists for this org. */
  hasActiveSubscription: boolean
  /** A projects row exists for this org (a one-off engagement was sold). */
  hasProjectRow: boolean
  /** A schedule has been shared/published to this client (real phases to show). */
  hasPublishedSchedule: boolean
  /** The subscription's resolved tracks entitlement, when one exists. */
  subscriptionTrackCount?: number | null
}

export interface EngagementPresentation {
  /** Mirrors the wire shape the client home already reads (`ctx.clientType` /
   *  `SubscriptionResp.clientType`). */
  clientType: 'retainer' | 'project'
  /** Null for a project, and for a retainer with no subscription row yet
   *  (the "your plan is being set up" state). Otherwise the entitled track
   *  count TrackBoard sizes its lanes from. */
  trackCount: number | null
}

export function resolveEngagementPresentation(signals: EngagementSignals): EngagementPresentation {
  if (signals.hasActiveSubscription) {
    return { clientType: 'retainer', trackCount: signals.subscriptionTrackCount ?? null }
  }
  if (signals.hasProjectRow || signals.hasPublishedSchedule) {
    return { clientType: 'project', trackCount: null }
  }
  return { clientType: 'retainer', trackCount: null }
}
