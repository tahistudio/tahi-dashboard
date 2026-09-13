/**
 * Onboarding completion is a property of the ORGANISATION, not the signed-in
 * user (the reported bug: a colleague invited into an already-onboarded org
 * via a plain Clerk organization invitation landed on the client onboarding
 * wizard, because their own Clerk publicMetadata.onboardingComplete flag had
 * never been set - only their organisation had finished onboarding).
 */
import { describe, it, expect } from 'vitest'
import {
  isOrgOnboarded,
  isEffectivelyOnboarded,
  parseOnboardingState,
  stampOrgOnboarded,
  ORG_ONBOARDED_KEY,
  LIVE_SUBSCRIPTION_STATUSES,
  type OrgOnboardingSignals,
} from '@/lib/org-onboarding'

const blank: OrgOnboardingSignals = {
  onboardingState: {},
  hasLiveSubscription: false,
  hasProjectEngagement: false,
}

describe('isOrgOnboarded', () => {
  it('is false for a brand new org with none of the signals', () => {
    expect(isOrgOnboarded(blank)).toBe(false)
  })

  it('is true once the org row carries the stamped completion key', () => {
    expect(
      isOrgOnboarded({ ...blank, onboardingState: { [ORG_ONBOARDED_KEY]: true } }),
    ).toBe(true)
  })

  it('ignores a falsy or missing stamp', () => {
    expect(isOrgOnboarded({ ...blank, onboardingState: { [ORG_ONBOARDED_KEY]: false } })).toBe(false)
    expect(isOrgOnboarded({ ...blank, onboardingState: {} })).toBe(false)
  })

  it('is true for an org holding a live subscription (the reported bug scenario)', () => {
    // Company Inc: an established retainer client. A second colleague invited
    // straight in must read this org as onboarded even though nobody has ever
    // stamped ORG_ONBOARDED_KEY for it (e.g. it predates this fix, or was
    // provisioned by an import path).
    expect(isOrgOnboarded({ ...blank, hasLiveSubscription: true })).toBe(true)
  })

  it('is true for an org holding a project engagement', () => {
    expect(isOrgOnboarded({ ...blank, hasProjectEngagement: true })).toBe(true)
  })

  it('is false when neither the stamp nor any engagement is present', () => {
    expect(
      isOrgOnboarded({
        onboardingState: { welcomeVideoWatched: true },
        hasLiveSubscription: false,
        hasProjectEngagement: false,
      }),
    ).toBe(false)
  })
})

describe('LIVE_SUBSCRIPTION_STATUSES', () => {
  it('treats active, trialing and past_due as live', () => {
    expect(LIVE_SUBSCRIPTION_STATUSES.has('active')).toBe(true)
    expect(LIVE_SUBSCRIPTION_STATUSES.has('trialing')).toBe(true)
    expect(LIVE_SUBSCRIPTION_STATUSES.has('past_due')).toBe(true)
  })

  it('does not treat paused or cancelled as live', () => {
    expect(LIVE_SUBSCRIPTION_STATUSES.has('paused')).toBe(false)
    expect(LIVE_SUBSCRIPTION_STATUSES.has('cancelled')).toBe(false)
  })
})

describe('parseOnboardingState', () => {
  it('defaults null / undefined / empty to {}', () => {
    expect(parseOnboardingState(null)).toEqual({})
    expect(parseOnboardingState(undefined)).toEqual({})
    expect(parseOnboardingState('')).toEqual({})
  })

  it('parses a stored object blob', () => {
    expect(parseOnboardingState('{"welcomeVideoWatched":true}')).toEqual({
      welcomeVideoWatched: true,
    })
  })

  it('degrades unparseable JSON to {} rather than throwing', () => {
    expect(parseOnboardingState('not json')).toEqual({})
  })

  it('degrades a non-object JSON value (array, string, number) to {}', () => {
    expect(parseOnboardingState('[1,2,3]')).toEqual({})
    expect(parseOnboardingState('"a string"')).toEqual({})
    expect(parseOnboardingState('42')).toEqual({})
  })
})

describe('stampOrgOnboarded', () => {
  it('adds the key to an empty blob', () => {
    expect(JSON.parse(stampOrgOnboarded(null))).toEqual({ [ORG_ONBOARDED_KEY]: true })
    expect(JSON.parse(stampOrgOnboarded('{}'))).toEqual({ [ORG_ONBOARDED_KEY]: true })
  })

  it('preserves the first-run checklist keys already stored alongside it', () => {
    const result = JSON.parse(
      stampOrgOnboarded('{"welcomeVideoWatched":true,"brandAssetsUploaded":false}'),
    )
    expect(result).toEqual({
      welcomeVideoWatched: true,
      brandAssetsUploaded: false,
      [ORG_ONBOARDED_KEY]: true,
    })
  })

  it('is idempotent: stamping an already-stamped blob changes nothing else', () => {
    const once = stampOrgOnboarded('{"welcomeVideoWatched":true}')
    const twice = stampOrgOnboarded(once)
    expect(JSON.parse(twice)).toEqual({ welcomeVideoWatched: true, [ORG_ONBOARDED_KEY]: true })
  })
})

describe('isEffectivelyOnboarded', () => {
  it('is true when the user flag alone is set', () => {
    expect(isEffectivelyOnboarded({ userOnboardingComplete: true, orgOnboarded: false })).toBe(true)
  })

  it('is true when only the org qualifies (the reported bug: a fresh seat, no user flag yet)', () => {
    expect(isEffectivelyOnboarded({ userOnboardingComplete: false, orgOnboarded: true })).toBe(true)
  })

  it('is false when neither measure says so (a genuinely new org and a genuinely new user)', () => {
    expect(isEffectivelyOnboarded({ userOnboardingComplete: false, orgOnboarded: false })).toBe(false)
  })

  it('is true when both measures agree', () => {
    expect(isEffectivelyOnboarded({ userOnboardingComplete: true, orgOnboarded: true })).toBe(true)
  })
})
