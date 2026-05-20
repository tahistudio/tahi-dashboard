import { describe, expect, it } from 'vitest'
import { deriveBilling, type BillingSignals } from '../billing-derivation'

const empty: BillingSignals = {
  hasActiveSubscription: false,
  customMrr: null,
  recentBillableHours: 0,
  hasActiveProject: false,
  hasWonDealWithUpfront: false,
  firstSubscriptionStart: null,
  lastPaidInvoiceDate: null,
  cancelledSubscriptionAt: null,
}

describe('deriveBilling', () => {
  it('returns none when no signals are present', () => {
    const r = deriveBilling(empty)
    expect(r.billingModel).toBe('none')
    expect(r.retainerStartDate).toBeNull()
    expect(r.retainerEndDate).toBeNull()
  })

  it('marks an org as retainer when an active subscription exists', () => {
    const r = deriveBilling({
      ...empty,
      hasActiveSubscription: true,
      firstSubscriptionStart: '2025-09-01T00:00:00Z',
    })
    expect(r.billingModel).toBe('retainer')
    expect(r.retainerStartDate).toBe('2025-09-01T00:00:00Z')
    expect(r.retainerEndDate).toBeNull()
    expect(r.reasoning).toContain('active Stripe subscription')
  })

  it('marks an org as retainer from customMrr when no subscription', () => {
    const r = deriveBilling({ ...empty, customMrr: 2500 })
    expect(r.billingModel).toBe('retainer')
    expect(r.reasoning).toContain('customMrr')
  })

  it('falls back to lastPaidInvoiceDate when no subscription start exists', () => {
    const r = deriveBilling({
      ...empty,
      customMrr: 1500,
      lastPaidInvoiceDate: '2025-12-01T00:00:00Z',
    })
    expect(r.retainerStartDate).toBe('2025-12-01T00:00:00Z')
  })

  it('marks an org as hourly when recent billable hours exist with no project', () => {
    const r = deriveBilling({ ...empty, recentBillableHours: 12.5 })
    expect(r.billingModel).toBe('hourly')
    expect(r.reasoning).toContain('billable hrs')
  })

  it('prefers project over hourly when both signals are present', () => {
    const r = deriveBilling({
      ...empty,
      recentBillableHours: 8,
      hasActiveProject: true,
    })
    expect(r.billingModel).toBe('project')
  })

  it('marks an org as project from a won deal with upfront value', () => {
    const r = deriveBilling({ ...empty, hasWonDealWithUpfront: true })
    expect(r.billingModel).toBe('project')
    expect(r.reasoning).toContain('won deal')
  })

  it('sets retainerEndDate when a cancelled subscription has no active replacement', () => {
    const r = deriveBilling({
      ...empty,
      customMrr: 0,
      hasActiveSubscription: false,
      cancelledSubscriptionAt: '2026-04-15T00:00:00Z',
      firstSubscriptionStart: '2025-01-01T00:00:00Z',
    })
    expect(r.billingModel).toBe('none')
    expect(r.retainerEndDate).toBeNull()
  })

  it('does not set retainerEndDate when subscription is still active', () => {
    const r = deriveBilling({
      ...empty,
      hasActiveSubscription: true,
      cancelledSubscriptionAt: '2025-09-15T00:00:00Z',
      firstSubscriptionStart: '2025-01-01T00:00:00Z',
    })
    expect(r.retainerEndDate).toBeNull()
  })

  it('precedence: active subscription beats customMrr', () => {
    const r = deriveBilling({
      ...empty,
      hasActiveSubscription: true,
      customMrr: 999,
      firstSubscriptionStart: '2025-09-01T00:00:00Z',
    })
    expect(r.reasoning).toContain('active Stripe subscription')
    expect(r.reasoning).not.toContain('customMrr')
  })
})
