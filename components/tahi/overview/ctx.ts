/**
 * Shared context passed from the Overview switcher to each role home
 * (owner / teammate / client). The switcher owns audience resolution
 * (permissions level), the go() route mapping, impersonation read-only state,
 * and the client home/clientType signals; each home consumes this ctx and
 * calls useOvFormat() itself for currency.
 */

export type OverviewAudience = 'owner' | 'teammate' | 'client'

export interface OverviewCtx {
  /** Resolved audience: owner (super_admin/admin), teammate (scoped team member), client. */
  audience: OverviewAudience
  /** Read-only lens: true while previewing-as / impersonating. Disables write controls. */
  isReadOnly: boolean
  /**
   * Money stays read-only even when the rest of the page does not.
   *
   * Act as client lets a super admin do a client's WORK (file a request, tick a
   * first-run step, reorder their queue), which flips isReadOnly to false. It
   * does not let the studio spend a client's money: reaching the hosted payment
   * page for someone else's invoice is not a thing an operator should be one
   * mis-click from, and the portal invoice surfaces refuse it in both modes for
   * the same reason. Defaults to isReadOnly when a caller does not set it, so
   * nothing that has not thought about it can get more permissive by accident.
   */
  isMoneyReadOnly?: boolean
  /** Name of the subject being previewed, when isReadOnly (else null). */
  previewName?: string | null
  /**
   * Navigate to a real dashboard route by logical id (e.g. 'requests',
   * 'invoices', 'calls', 'financialreports', 'plan'). The switcher maps ids to
   * real paths; homes just call go('invoices').
   */
  go: (routeId: string) => void
  /** Client home only: 'first' shows the first-run welcome, 'steady' hides it. */
  home?: 'steady' | 'first'
  /** Client home only: retainer (TrackBoard) vs project (ProjectBoard). */
  clientType?: 'retainer' | 'project'
  /** Signed-in user's display name (for greetings). */
  userName?: string
  /** Org name (client portal + preview). */
  orgName?: string
}
