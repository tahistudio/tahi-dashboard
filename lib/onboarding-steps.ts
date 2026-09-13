/**
 * lib/onboarding-steps.ts
 *
 * Which screens a person walks through in client onboarding, as a pure
 * function of the two facts the invite carries: the engagement and whether
 * this is a new client or one the studio already bills.
 *
 * Split out of components/tahi/onboarding-content.tsx rather than left inline
 * for one reason: it is the only part of onboarding that decides whether a
 * client is shown a plan picker and a live Stripe card form, and it had no
 * test. The existing-client branch was changed once already (it used to return
 * ['welcome','plan','pay'], which routed a client the studio invoices on the
 * Xero rail into a real checkout), and the only thing standing behind that
 * change was a Playwright persona that needs Clerk keys and is flaky under
 * load. A pure function with a unit test per branch is the regression guard
 * the new-client paths were missing.
 *
 * The step ids are the keys the shell's rail labels and the flow's switch both
 * read; see META in onboarding-content.tsx.
 */

/** A retainer is ongoing; a project is a fixed piece of work. */
export type OnboardingEngagement = 'project' | 'retainer'

/** New to the studio, or already on the books when the invite was minted. */
export type OnboardingClientType = 'new' | 'existing'

/**
 * The steps, in order, for one path through client onboarding.
 *
 *   new + retainer     welcome, plan, pay, details, invite. The self-serve
 *                      path, and the only one that touches Stripe.
 *   new + project      welcome, details, invite, kickoff. Care-first; the
 *                      contract is settled off the platform, so no payment.
 *   existing, either   welcome, kickoff. Terms were agreed before the invite
 *                      and the studio already invoices them (often on the Xero
 *                      rail), so an existing client is never shown a plan
 *                      picker or a card form. The server refuses too: POST
 *                      /api/portal/checkout answers 409 for an org that holds
 *                      an active retainer or bills on the Xero rail, so a stale
 *                      tab cannot open a second real Stripe subscription
 *                      against a paying client.
 */
export function buildSteps(
  engagement: OnboardingEngagement,
  clientType: OnboardingClientType,
): string[] {
  if (clientType === 'existing') return ['welcome', 'kickoff']
  if (engagement === 'project') return ['welcome', 'details', 'invite', 'kickoff']
  return ['welcome', 'plan', 'pay', 'details', 'invite']
}

/**
 * Does this path put the client in front of a payment form?
 *
 * The honest answer to "can this person reach Stripe from onboarding", for
 * anything that needs to reason about the flow without reproducing the table
 * above. Exactly one path can.
 */
export function stepsTakePayment(steps: readonly string[]): boolean {
  return steps.includes('pay')
}
