import { test, expect } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import { createPageObjects } from '@clerk/testing/playwright/unstable'
import { createTestOrg, mintInvite, testEmail } from './helpers/invites'

/**
 * Onboarding persona e2e — proves the invited-link survives a real Clerk sign-up
 * and each persona lands in the correct flow, with NO real inbox or password:
 * Clerk test mode (`+clerk_test` emails, fixed OTP entered by enterTestOtpCode).
 *
 * Covers the four personas Liam asked for:
 *   1. New self-serve visitor              -> "How can we help?" chooser
 *   2. Invited project, $20k USD off-invoice -> invited project flow, no payment
 *   3. Invited project, $30k NZD off-invoice -> invited project flow, no payment
 *   4. Invited teammate                     -> team "Welcome to Tahi" flow
 *
 * Personas 2 + 3 are structurally identical (the project value is invoiced
 * off-platform, so it is not carried on the invite); both are exercised to prove
 * the link + email-binding + flow are correct regardless of the deal value.
 *
 * Requires Clerk keys (dev instance) in the Playwright env; skips cleanly without.
 */

const PASSWORD = 'Tahi-e2e-Test-9f3!q'
const hasClerk = !!process.env.CLERK_SECRET_KEY

test.describe('Onboarding personas (Clerk test mode)', () => {
  test.skip(!hasClerk, 'Clerk keys not configured; set CLERK_SECRET_KEY to run.')

  test('1. new self-serve visitor lands in the chooser', async ({ page, baseURL }) => {
    await setupClerkTestingToken({ page })
    const po = createPageObjects({ page, useTestingToken: true, baseURL: baseURL! })
    const email = testEmail('selfserve', Date.now())

    await page.goto('/sign-up')
    await po.signUp.waitForMounted()
    await po.signUp.signUp({ email, password: PASSWORD, firstName: 'Sole', lastName: 'Trader' })
    await po.signUp.enterTestOtpCode()
    await po.signUp.waitForSession()

    await page.goto('/onboarding')
    await expect(page.getByText(/how can we help/i)).toBeVisible({ timeout: 15_000 })
    // The self-serve chooser offers retainer vs project; never a pre-set flow.
    await expect(page.getByText(/everything.?s ready/i)).toHaveCount(0)
  })

  test('2. invited project ($20k USD, off-invoice) lands in the invited flow', async ({ page, baseURL }) => {
    await setupClerkTestingToken({ page })
    const po = createPageObjects({ page, useTestingToken: true, baseURL: baseURL! })
    const email = testEmail('proj-usd', Date.now())

    const orgId = await createTestOrg('Northwind Co (e2e USD)')
    const { token } = await mintInvite({ orgId, flow: 'client', persona: 'project', contactEmail: email, contactName: 'Dana Cole' })

    // Hitting the invite link logged-out stashes the token in a cookie (middleware)
    // and redirects to sign-in; the token must survive the whole sign-up round-trip.
    await page.goto(`/onboarding?token=${token}`)
    await page.goto('/sign-up')
    await po.signUp.waitForMounted()
    await po.signUp.signUp({ email, password: PASSWORD, firstName: 'Dana', lastName: 'Cole' })
    await po.signUp.enterTestOtpCode()
    await po.signUp.waitForSession()

    await page.goto('/onboarding')
    // Invited project flow: never the self-serve chooser, never a pay step.
    await expect(page.getByText(/how can we help/i)).toHaveCount(0)
    await expect(page.getByText(/everything.?s ready|kickoff|your team/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('3. invited project ($30k NZD, off-invoice) lands in the invited flow', async ({ page, baseURL }) => {
    await setupClerkTestingToken({ page })
    const po = createPageObjects({ page, useTestingToken: true, baseURL: baseURL! })
    const email = testEmail('proj-nzd', Date.now())

    const orgId = await createTestOrg('Kahu Labs (e2e NZD)')
    const { token } = await mintInvite({ orgId, flow: 'client', persona: 'project', contactEmail: email, contactName: 'Mere Tai' })

    await page.goto(`/onboarding?token=${token}`)
    await page.goto('/sign-up')
    await po.signUp.waitForMounted()
    await po.signUp.signUp({ email, password: PASSWORD, firstName: 'Mere', lastName: 'Tai' })
    await po.signUp.enterTestOtpCode()
    await po.signUp.waitForSession()

    await page.goto('/onboarding')
    await expect(page.getByText(/how can we help/i)).toHaveCount(0)
    await expect(page.getByText(/everything.?s ready|kickoff|your team/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('4. invited teammate lands in the team welcome flow', async ({ page, baseURL }) => {
    await setupClerkTestingToken({ page })
    const po = createPageObjects({ page, useTestingToken: true, baseURL: baseURL! })
    const email = testEmail('team', Date.now())

    const { token } = await mintInvite({ flow: 'team', contactEmail: email, contactName: 'Alex Kerr' })

    await page.goto(`/welcome?token=${token}`)
    await page.goto('/sign-up')
    await po.signUp.waitForMounted()
    await po.signUp.signUp({ email, password: PASSWORD, firstName: 'Alex', lastName: 'Kerr' })
    await po.signUp.enterTestOtpCode()
    await po.signUp.waitForSession()

    await page.goto('/welcome')
    // The teammate "Welcome to Tahi" flow, never the client chooser.
    await expect(page.getByText(/how can we help/i)).toHaveCount(0)
    await expect(page.getByText(/welcome to tahi|your first day|teammate/i).first()).toBeVisible({ timeout: 15_000 })
  })
})
