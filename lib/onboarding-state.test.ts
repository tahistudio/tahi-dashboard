/**
 * deriveOnboardingState: the first-run panel must not greet an established
 * client as a brand new one.
 *
 * organisations.onboardingState is only ever written by the panel itself and is
 * seeded '{}' by every import path, so trusting it alone showed a two-year
 * client a 0/4 setup checklist at cutover.
 */
import { describe, it, expect } from 'vitest'
import { deriveOnboardingState, FIRST_RUN_MAX_AGE_DAYS } from '@/lib/onboarding-state'

const NOW = Date.parse('2026-09-05T00:00:00.000Z')

function daysAgo(n: number): string {
  return new Date(NOW - n * 86_400_000).toISOString()
}

const blank = {
  hasAnyRequest: false,
  hasDeliveredRequest: false,
  hasActiveSubscription: false,
  hasPaidInvoice: false,
  orgCreatedAt: daysAgo(1),
  now: NOW,
}

describe('deriveOnboardingState', () => {
  it('leaves a genuinely new org eligible with nothing ticked', () => {
    const { state, firstRunEligible } = deriveOnboardingState({}, blank)
    expect(firstRunEligible).toBe(true)
    expect(state.firstRequestSubmitted).toBeUndefined()
    expect(state.billingSetUp).toBeUndefined()
  })

  it('derives firstRequestSubmitted from a real request', () => {
    const { state } = deriveOnboardingState({}, { ...blank, hasAnyRequest: true })
    expect(state.firstRequestSubmitted).toBe(true)
  })

  it('derives billingSetUp from an active subscription', () => {
    const { state } = deriveOnboardingState({}, { ...blank, hasActiveSubscription: true })
    expect(state.billingSetUp).toBe(true)
  })

  it('derives billingSetUp from a paid invoice', () => {
    const { state } = deriveOnboardingState({}, { ...blank, hasPaidInvoice: true })
    expect(state.billingSetUp).toBe(true)
  })

  it('keeps the two self-attested steps manual', () => {
    const { state } = deriveOnboardingState(
      {},
      { ...blank, hasAnyRequest: true, hasActiveSubscription: true },
    )
    expect(state.welcomeVideoWatched).toBeUndefined()
    expect(state.brandAssetsUploaded).toBeUndefined()
  })

  it('never unticks a step the client already ticked', () => {
    const { state } = deriveOnboardingState({ welcomeVideoWatched: true }, blank)
    expect(state.welcomeVideoWatched).toBe(true)
  })

  it('refuses a first run for an org with delivered work', () => {
    const { firstRunEligible } = deriveOnboardingState(
      {},
      { ...blank, hasAnyRequest: true, hasDeliveredRequest: true },
    )
    expect(firstRunEligible).toBe(false)
  })

  it('refuses a first run for an org older than the window', () => {
    const { firstRunEligible } = deriveOnboardingState(
      {},
      { ...blank, orgCreatedAt: daysAgo(FIRST_RUN_MAX_AGE_DAYS + 1) },
    )
    expect(firstRunEligible).toBe(false)
  })

  it('is the exact case the audit named: an imported org with an empty blob', () => {
    const { state, firstRunEligible } = deriveOnboardingState(
      {},
      {
        ...blank,
        orgCreatedAt: daysAgo(400),
        hasAnyRequest: true,
        hasDeliveredRequest: true,
        hasActiveSubscription: true,
      },
    )
    expect(firstRunEligible).toBe(false)
    expect(state.firstRequestSubmitted).toBe(true)
    expect(state.billingSetUp).toBe(true)
  })

  it('stops being eligible once every step is done', () => {
    const { firstRunEligible } = deriveOnboardingState(
      { welcomeVideoWatched: true, brandAssetsUploaded: true },
      { ...blank, hasAnyRequest: true, hasActiveSubscription: true },
    )
    expect(firstRunEligible).toBe(false)
  })

  it('stays eligible when the org age is unknown', () => {
    const { firstRunEligible } = deriveOnboardingState({}, { ...blank, orgCreatedAt: null })
    expect(firstRunEligible).toBe(true)
  })

  it('ignores an unparseable createdAt rather than hiding the panel', () => {
    const { firstRunEligible } = deriveOnboardingState({}, { ...blank, orgCreatedAt: 'whenever' })
    expect(firstRunEligible).toBe(true)
  })
})
