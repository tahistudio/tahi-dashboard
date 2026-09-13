/**
 * The client-onboarding step table, pinned per branch.
 *
 * T1.4 (c). The existing-client branch was rewritten once (S2: it used to
 * return ['welcome','plan','pay'], which routed a client the studio invoices on
 * the Xero rail into a live Stripe checkout). Nothing fast covered the OTHER
 * three branches while that happened, so a new client silently losing their
 * plan picker, their card form or their kickoff would only have shown up in a
 * Playwright persona that needs Clerk keys and is flaky under load.
 *
 * These are the assertions that make the next edit to the table honest.
 */
import { describe, it, expect } from 'vitest'
import { buildSteps, stepsTakePayment } from '@/lib/onboarding-steps'

describe('buildSteps', () => {
  describe('new client', () => {
    it('walks a self-serve retainer through the plan picker and the card form', () => {
      expect(buildSteps('retainer', 'new')).toEqual([
        'welcome', 'plan', 'pay', 'details', 'invite',
      ])
    })

    it('walks an invited project past payment entirely, and ends on the kickoff', () => {
      // The contract is settled off the platform, so there is nothing to charge
      // here; the step that matters is that they still reach a kickoff.
      expect(buildSteps('project', 'new')).toEqual([
        'welcome', 'details', 'invite', 'kickoff',
      ])
    })

    it('is the only client type that can reach Stripe, and only on a retainer', () => {
      expect(stepsTakePayment(buildSteps('retainer', 'new'))).toBe(true)
      expect(stepsTakePayment(buildSteps('project', 'new'))).toBe(false)
    })
  })

  describe('existing client', () => {
    it('shows a retainer client welcome and kickoff, never a plan or a card form', () => {
      const steps = buildSteps('retainer', 'existing')
      expect(steps).toEqual(['welcome', 'kickoff'])
      expect(steps).not.toContain('plan')
      expect(steps).not.toContain('pay')
    })

    it('treats a project client identically: terms were agreed before the invite', () => {
      expect(buildSteps('project', 'existing')).toEqual(['welcome', 'kickoff'])
    })

    it('never takes payment on either engagement', () => {
      expect(stepsTakePayment(buildSteps('retainer', 'existing'))).toBe(false)
      expect(stepsTakePayment(buildSteps('project', 'existing'))).toBe(false)
    })
  })

  it('always opens on welcome, whichever path the invite chose', () => {
    const paths: Array<[Parameters<typeof buildSteps>[0], Parameters<typeof buildSteps>[1]]> = [
      ['retainer', 'new'], ['project', 'new'], ['retainer', 'existing'], ['project', 'existing'],
    ]
    for (const [engagement, clientType] of paths) {
      expect(buildSteps(engagement, clientType)[0]).toBe('welcome')
    }
  })

  it('returns a fresh array each call, so a caller cannot mutate the table', () => {
    const first = buildSteps('retainer', 'new')
    first.push('surprise')
    expect(buildSteps('retainer', 'new')).toEqual([
      'welcome', 'plan', 'pay', 'details', 'invite',
    ])
  })
})
