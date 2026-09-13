/**
 * lib/__tests__/engagement-presentation.test.ts
 *
 * A custom PRICE is not a one-off PROJECT. Before this, the client portal
 * home decided ProjectBoard vs TrackBoard purely from "no active
 * subscription => project", so a custom-priced retainer client with no
 * subscription row yet (nothing provisioned) was shown project phases and
 * a "Project progress" KPI for an engagement that was never sold to them.
 * These cases pin the fixed decision: an active subscription is always a
 * retainer, a real project signal with no active subscription is a project,
 * and anything else (including a bare 'custom' plan type with neither) is a
 * retainer whose plan is still being set up.
 */
import { describe, it, expect } from 'vitest'
import { resolveEngagementPresentation } from '@/lib/engagement-presentation'

describe('resolveEngagementPresentation', () => {
  it('is a retainer with no track count when a custom-priced client has no project and no subscription yet', () => {
    const result = resolveEngagementPresentation({
      hasActiveSubscription: false,
      hasProjectRow: false,
      hasPublishedSchedule: false,
    })
    expect(result).toEqual({ clientType: 'retainer', trackCount: null })
  })

  it('is a project when a projects row exists and there is no active subscription', () => {
    const result = resolveEngagementPresentation({
      hasActiveSubscription: false,
      hasProjectRow: true,
      hasPublishedSchedule: false,
    })
    expect(result).toEqual({ clientType: 'project', trackCount: null })
  })

  it('is a project when a schedule has been published and there is no active subscription', () => {
    const result = resolveEngagementPresentation({
      hasActiveSubscription: false,
      hasProjectRow: false,
      hasPublishedSchedule: true,
    })
    expect(result).toEqual({ clientType: 'project', trackCount: null })
  })

  it('is a retainer sized from the subscription tracks entitlement when a subscription is active', () => {
    const result = resolveEngagementPresentation({
      hasActiveSubscription: true,
      hasProjectRow: false,
      hasPublishedSchedule: false,
      subscriptionTrackCount: 3,
    })
    expect(result).toEqual({ clientType: 'retainer', trackCount: 3 })
  })

  it('an active subscription wins as retainer even when a project row also exists (converted client)', () => {
    const result = resolveEngagementPresentation({
      hasActiveSubscription: true,
      hasProjectRow: true,
      hasPublishedSchedule: true,
      subscriptionTrackCount: 2,
    })
    expect(result).toEqual({ clientType: 'retainer', trackCount: 2 })
  })

  it('defaults an active subscription with no known track count to null rather than 0', () => {
    const result = resolveEngagementPresentation({
      hasActiveSubscription: true,
      hasProjectRow: false,
      hasPublishedSchedule: false,
    })
    expect(result).toEqual({ clientType: 'retainer', trackCount: null })
  })
})
