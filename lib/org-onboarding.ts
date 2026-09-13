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
 * Onboarding completion is a property of the ORGANISATION, not the
 * individual signed-in user. An org counts as onboarded once ANY of:
 *   - organisations.onboardingState carries ORG_ONBOARDED_KEY = true. Written
 *     by POST /api/onboarding/complete the moment ANY contact at the org
 *     first completes the client wizard, so every later seat of the same org
 *     reads a plain column instead of asking Clerk about every other contact.
 *   - the org holds a LIVE subscription (a retainer someone already pays
 *     for), or
 *   - the org holds a project engagement (a one-off someone already signed
 *     off on).
 * Any one of those only exists for an org a person already walked through
 * onboarding for, self-serve or otherwise.
 *
 * Pure, D1/Clerk-free, so every branch is testable without a database. See
 * lib/org-onboarding-server.ts for the D1 + Clerk wiring around this.
 */

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

export interface OrgOnboardingSignals {
  /** organisations.onboardingState, already parsed. {} when missing/unreadable. */
  onboardingState: Record<string, unknown>
  /** Any subscriptions row for this org has a status in LIVE_SUBSCRIPTION_STATUSES. */
  hasLiveSubscription: boolean
  /** Any projects row exists for this org (a one-off engagement). */
  hasProjectEngagement: boolean
}

/** Is this ORGANISATION onboarded, regardless of which seat is asking? */
export function isOrgOnboarded(signals: OrgOnboardingSignals): boolean {
  if (signals.onboardingState?.[ORG_ONBOARDED_KEY] === true) return true
  if (signals.hasLiveSubscription) return true
  if (signals.hasProjectEngagement) return true
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
