import { describe, it, expect } from 'vitest'
import { isRetainerOrg } from '@/lib/retainer-org-filter'

describe('isRetainerOrg', () => {
  it('includes an org with a positive customMrr and no billing model', () => {
    expect(isRetainerOrg({ billingModel: null, customMrr: 500 })).toBe(true)
  })

  it('includes an org explicitly billed as retainer with a positive customMrr', () => {
    expect(isRetainerOrg({ billingModel: 'retainer', customMrr: 1200 })).toBe(true)
  })

  it('excludes an org with customMrr null, even nothing else disqualifies it', () => {
    expect(isRetainerOrg({ billingModel: null, customMrr: null })).toBe(false)
  })

  it('excludes an org with customMrr 0 (the live beta bug: Tahi Test Client)', () => {
    // Beta audit, 2026-09-19: Tahi Test Client (customMrr 0, Liam's own test
    // org) had an active subscription row and slipped through the old
    // `|| subStatus === 'active'` fallback, getting scored for churn risk
    // like a real retainer client.
    expect(isRetainerOrg({ billingModel: null, customMrr: 0 })).toBe(false)
  })

  it('excludes an hourly-billed org even with a positive customMrr', () => {
    expect(isRetainerOrg({ billingModel: 'hourly', customMrr: 3000 })).toBe(false)
  })

  it('excludes a project-billed org even with a positive customMrr', () => {
    expect(isRetainerOrg({ billingModel: 'project', customMrr: 3000 })).toBe(false)
  })

  it('excludes a negative customMrr', () => {
    expect(isRetainerOrg({ billingModel: null, customMrr: -100 })).toBe(false)
  })
})
