/**
 * lib/org-onboarding.ts
 *
 * THE BUG THIS EXISTS FOR: Liam invited a colleague to an existing, already
 * onboarded client org (Company Inc) through a plain Clerk organization
 * invitation. Accepting it gave the colleague a valid session inside that
 * org, and the dashboard layout gated their access on the SIGNED-IN USER's
 * Clerk publicMetadata.onboardingComplete flag alone. That flag is written
 * exactly once per Clerk user, only by POST /api/onboarding/complete, which
 * this colleague had never called - so a brand new seat of a two-year client
 * landed on the client onboarding wizard's "Ongoing design & build / A
 * one-off project" chooser instead of straight inside their own
 * organisation's portal.
 *
 * Company Inc's own shape is the reason this needs FOUR clauses, not three:
 * it is on a custom plan (no subscriptions row), has no projects row either,
 * and its first contact finished the wizard before ORG_ONBOARDED_KEY existed
 * - so the first three clauses alone still send a second seat there back to
 * the wizard. What Company Inc DOES have, from that first contact's real use
 * of the portal, is first-run checklist activity and/or a request they
 * submitted themselves. Both are backfill-free: they already sit in data
 * nobody has to migrate.
 *
 * Onboarding completion is a property of the ORGANISATION, not the
 * individual signed-in user. An org counts as onboarded once ANY of:
 *   - organisations.onboardingState carries ORG_ONBOARDED_KEY = true. Written
 *     by POST /api/onboarding/complete the moment ANY contact at the org
 *     first completes the client wizard, so every later seat of the same org
 *     reads a plain column instead of asking Clerk about every other contact.
 *   - the org holds a LIVE subscription (a retainer someone already pays
 *     for), or
 *   - the org holds a project engagement (a one-off someone already signed
 *     off on), or
 *   - the org holds a REQUEST authored by one of its own contacts (submitted
 *     through the portal, not created on their behalf by the studio), or
 *   - organisations.onboardingState already carries any key from the client
 *     home's first-run checklist (CLIENT_HOME_CHECKLIST_KEYS below). That
 *     checklist only renders on the post-onboarding client home, and the only
 *     writer of any key into this JSON blob is the PATCH route behind it
 *     (see app/api/portal/onboarding/route.ts) - so a key's mere PRESENCE,
 *     true or false, proves a contact already reached the portal proper.
 * Any one of those only exists for an org a person already walked through
 * onboarding for, self-serve or otherwise.
 *
 * Pure, D1/Clerk-free, so every branch is testable without a database. See
 * lib/org-onboarding-server.ts for the D1 + Clerk wiring around this.
 */

import { SELF_ATTESTED_STEPS, DERIVED_STEPS } from '@/lib/onboarding-state'

/**
 * The key POST /api/onboarding/complete stamps into
 * organisations.onboardingState the first time any contact at the org
 * completes the client wizard. Lives in the same JSON blob as the first-run
 * checklist's self-attested / derived steps (lib/onboarding-state.ts) but is
 * a distinct signal: that checklist is about a post-onboarding portal panel,
 * this one is about whether the org should ever see the initial wizard again.
 */
export const ORG_ONBOARDED_KEY = 'orgOnboardingComplete'

/** subscriptions.status values that mean "this org is a live, paying client". */
export const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'trialing',
  'past_due',
])

/**
 * The client home first-run checklist's own step keys (ClientFirstRun /
 * CL_STEPS in components/tahi/overview/homes/client-home.tsx, persisted via
 * PATCH /api/portal/onboarding). These are the same four steps
 * lib/onboarding-state.ts already names as SELF_ATTESTED_STEPS +
 * DERIVED_STEPS; reused rather than re-hardcoded so the two lists cannot
 * drift. 'meetTheTeam' is named by components/tahi/onboarding-checklist.tsx,
 * a fifth step from an alternate checklist design that is not wired into any
 * page today. It is included anyway: the PATCH route is the ONLY writer of
 * any key into organisations.onboardingState's checklist namespace (the
 * other writer, POST /api/onboarding/complete, only ever writes
 * ORG_ONBOARDED_KEY), so if 'meetTheTeam' is ever revived it will mean the
 * same thing every other key here means - someone reached the portal.
 */
export const CLIENT_HOME_CHECKLIST_KEYS: readonly string[] = [
  ...SELF_ATTESTED_STEPS,
  ...DERIVED_STEPS,
  'meetTheTeam',
]

export interface OrgOnboardingSignals {
  /** organisations.onboardingState, already parsed. {} when missing/unreadable. */
  onboardingState: Record<string, unknown>
  /** Any subscriptions row for this org has a status in LIVE_SUBSCRIPTION_STATUSES. */
  hasLiveSubscription: boolean
  /** Any projects row exists for this org (a one-off engagement). */
  hasProjectEngagement: boolean
  /**
   * At least one requests row for this org was authored by one of the org's
   * OWN contacts (submittedByType 'contact' with a submittedById that
   * resolves to a real contacts row at this org) - i.e. submitted through the
   * portal, not created on the client's behalf by the studio. A studio-side
   * create can also stamp submittedByType 'contact' by column default while
   * carrying the STUDIO caller's id, so this must be proven against the
   * contacts table, never taken on the column value alone; see
   * lib/org-onboarding-server.ts.
   */
  hasPortalContactRequest: boolean
}

/** Is this ORGANISATION onboarded, regardless of which seat is asking? */
export function isOrgOnboarded(signals: OrgOnboardingSignals): boolean {
  if (signals.onboardingState?.[ORG_ONBOARDED_KEY] === true) return true
  if (signals.hasLiveSubscription) return true
  if (signals.hasProjectEngagement) return true
  if (signals.hasPortalContactRequest) return true
  if (CLIENT_HOME_CHECKLIST_KEYS.some(key => key in (signals.onboardingState ?? {}))) return true
  return false
}

/** Parse organisations.onboardingState defensively. Never throws. */
export function parseOnboardingState(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Stamp the org-level completion marker onto a stored onboardingState blob.
 * Idempotent (a second call reproduces the same JSON), and leaves every other
 * key untouched, including the first-run checklist's own steps.
 */
export function stampOrgOnboarded(raw: string | null | undefined): string {
  const state = parseOnboardingState(raw)
  if (state[ORG_ONBOARDED_KEY] === true) return JSON.stringify(state)
  return JSON.stringify({ ...state, [ORG_ONBOARDED_KEY]: true })
}

export interface OnboardingGateInput {
  /** The signed-in Clerk user's own publicMetadata.onboardingComplete flag. */
  userOnboardingComplete: boolean
  /** isOrgOnboarded(...) for the user's organisation. */
  orgOnboarded: boolean
}

/**
 * The one answer both the dashboard layout and the /onboarding page act on:
 * is this person done with onboarding, by EITHER measure? A user's own flag
 * says so on its own; so does an org that already qualifies, even for a seat
 * that never ran the wizard itself.
 */
export function isEffectivelyOnboarded(input: OnboardingGateInput): boolean {
  return input.userOnboardingComplete || input.orgOnboarded
}
