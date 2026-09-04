/**
 * lib/onboarding-state.ts
 *
 * `organisations.onboardingState` is a JSON blob that only the client's own
 * first-run panel ever writes. Every org created by an import path
 * (lib/stripe-import.ts, lib/stripe-sync.ts, lib/xero-sync.ts) is seeded with
 * '{}', so trusting the blob alone means greeting a two-year client with a 0/4
 * setup checklist.
 *
 * Two of the four steps are objectively knowable from the database, so we
 * derive those rather than asking. The other two are self-attested and stay
 * manual. Separately we decide whether the panel belongs on screen at all: an
 * org with delivered work, or one that has simply been around a while, is not
 * a first run no matter what the blob says.
 *
 * Pure so it is unit testable without a D1.
 */

/** Steps the client ticks themselves; nothing in the data can prove them. */
export const SELF_ATTESTED_STEPS = ['welcomeVideoWatched', 'brandAssetsUploaded'] as const

/** Steps we can read off the database. */
export const DERIVED_STEPS = ['firstRequestSubmitted', 'billingSetUp'] as const

/** Past this age an org is an established client, not a first run. */
export const FIRST_RUN_MAX_AGE_DAYS = 30

export interface OnboardingSignals {
  /** The org has submitted at least one request. */
  hasAnyRequest: boolean
  /** At least one request reached a delivered / archived state. */
  hasDeliveredRequest: boolean
  /** An active (or trialing) subscription exists. */
  hasActiveSubscription: boolean
  /** At least one invoice has been paid. */
  hasPaidInvoice: boolean
  /** organisations.createdAt, when readable. */
  orgCreatedAt?: string | null
  /** Injected for tests. */
  now?: number
}

export interface DerivedOnboarding {
  /** The stored blob with the two knowable steps forced true where true. */
  state: Record<string, boolean>
  /** False when this org is plainly not a new client. */
  firstRunEligible: boolean
}

function ageInDays(createdAt: string | null | undefined, now: number): number | null {
  if (!createdAt) return null
  const ms = new Date(createdAt).getTime()
  if (!Number.isFinite(ms)) return null
  return (now - ms) / 86_400_000
}

export function deriveOnboardingState(
  stored: Record<string, boolean>,
  signals: OnboardingSignals,
): DerivedOnboarding {
  const now = signals.now ?? Date.now()

  const state: Record<string, boolean> = { ...stored }
  if (signals.hasAnyRequest) state.firstRequestSubmitted = true
  if (signals.hasActiveSubscription || signals.hasPaidInvoice) state.billingSetUp = true

  const allDone = [...SELF_ATTESTED_STEPS, ...DERIVED_STEPS].every(key => state[key] === true)
  const age = ageInDays(signals.orgCreatedAt, now)
  const established =
    signals.hasDeliveredRequest || (age !== null && age > FIRST_RUN_MAX_AGE_DAYS)

  return { state, firstRunEligible: !allDone && !established }
}
