import { test, expect } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import { createPageObjects } from '@clerk/testing/playwright/unstable'
import { testEmail } from './helpers/invites'

/**
 * Auth path e2e (T1.3 / T1.8): sign-in, sign-up and forgot-password on the
 * branded <AuthShell>. Render and copy checks only, on the same Clerk test
 * mode harness as e2e/onboarding-personas.spec.ts (no real inbox). No real
 * password-reset code is ever entered: the forgot-password check proves the
 * step is reachable and still on-brand, then stops before any code entry.
 *
 * Requires Clerk keys (dev instance) in the Playwright env; skips cleanly
 * without.
 */

const PASSWORD = 'Tahi-e2e-Test-9f3!q'
const hasClerk = !!process.env.CLERK_SECRET_KEY

test.describe('Auth path (Clerk test mode)', () => {
  test.skip(!hasClerk, 'Clerk keys not configured; set CLERK_SECRET_KEY to run.')

  test('sign-in renders the branded shell and switches to sign-up', async ({ page, baseURL }) => {
    await setupClerkTestingToken({ page })
    const po = createPageObjects({ page, useTestingToken: true, baseURL: baseURL! })

    await page.goto('/sign-in')
    await po.signIn.waitForMounted()

    // Scene copy owned by AuthShell, not Clerk (see lib/auth-shell-config.ts).
    await expect(page.getByRole('heading', { name: /welcome back\./i })).toBeVisible()
    await expect(page.getByText(/trusted by some of the biggest companies/i)).toBeVisible()

    // Clerk's own footer is hidden by tahiClerkAppearance; our switch row
    // replaces it, and its identifier field clears the 44px mobile minimum.
    await expect(page.locator('.tahi-auth-card .cl-footer')).toBeHidden()
    const identifier = po.signIn.getIdentifierInput()
    await expect(identifier).toBeVisible()
    const box = await identifier.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

    await page.getByRole('link', { name: 'Sign up' }).click()
    await expect(page).toHaveURL(/\/sign-up/)
  })

  test('sign-up renders the branded shell, the legal line, and switches to sign-in', async ({ page, baseURL }) => {
    await setupClerkTestingToken({ page })
    const po = createPageObjects({ page, useTestingToken: true, baseURL: baseURL! })

    await page.goto('/sign-up')
    await po.signUp.waitForMounted()

    await expect(
      page.getByRole('heading', { name: /your project, start to finish, in one place\./i }),
    ).toBeVisible()
    await expect(page.locator('.tahi-auth-card .cl-headerTitle')).toHaveText(/create your workspace/i)
    await expect(page.getByText(/by continuing you agree to our/i)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')

    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/sign-in$/)
  })

  test('sign-up shows a branded, correctly worded OTP verification step', async ({ page, baseURL }) => {
    await setupClerkTestingToken({ page })
    const po = createPageObjects({ page, useTestingToken: true, baseURL: baseURL! })
    const email = testEmail('auth-path-otp', Date.now())

    await page.goto('/sign-up')
    await po.signUp.waitForMounted()
    await po.signUp.signUp({ email, password: PASSWORD, firstName: 'Otp', lastName: 'Check' })
    await po.signUp.waitForEmailVerificationScreen()

    // Wording from the ClerkProvider localization in app/layout.tsx, styled by
    // the same .cl-* rules as every other step. No code is entered here.
    await expect(page.locator('.tahi-auth-card .cl-headerTitle')).toHaveText(/check your email/i)
    await expect(page.getByText(/enter the 6-digit code/i)).toBeVisible()
    const otpBox = page.locator('.cl-otpCodeFieldInput').first()
    await expect(otpBox).toBeVisible()
    const box = await otpBox.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  test('forgot password is reachable from sign-in and the reset step stays on-brand', async ({ page, baseURL }) => {
    await setupClerkTestingToken({ page })
    const po = createPageObjects({ page, useTestingToken: true, baseURL: baseURL! })
    const email = testEmail('auth-path-forgot', Date.now())

    // One throwaway account so sign-in has a real identifier to continue past:
    // the multi-step sign-in only reveals the password / forgot-password step
    // once it recognises the identifier.
    await page.goto('/sign-up')
    await po.signUp.waitForMounted()
    await po.signUp.signUp({ email, password: PASSWORD, firstName: 'Forgot', lastName: 'Password' })
    await po.signUp.enterTestOtpCode()
    await po.signUp.waitForSession()
    await po.page.signOut()

    await page.goto('/sign-in')
    await po.signIn.waitForMounted()
    await po.signIn.setIdentifier(email)
    await po.signIn.continue()

    const forgot = po.signIn.getForgotPassword()
    await expect(forgot).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.tahi-auth-card')).toBeVisible()

    await forgot.click()
    // Render/copy check only: the widget must move off the password step into
    // the reset flow. No reset code is ever typed in this spec.
    await expect(po.signIn.getPasswordInput()).toBeHidden({ timeout: 15_000 })
    await expect(page.locator('.tahi-auth-card .cl-headerTitle')).toHaveText(/reset/i)
    await expect(page.locator('.tahi-auth-card')).toBeVisible()
  })
})

test.describe('Auth path at 375px with a saved dark-mode preference', () => {
  test.skip(!hasClerk, 'Clerk keys not configured; set CLERK_SECRET_KEY to run.')
  test.use({ viewport: { width: 375, height: 812 } })

  test('sign-in card stays on-brand with no horizontal overflow and 44px targets', async ({ page, baseURL }) => {
    // Mirrors the boot script in app/layout.tsx: a visitor who saved dark mode
    // elsewhere in the app still lands on a readable card here, because
    // AuthShell pins its own light tokens regardless of the <html> class.
    await page.addInitScript(() => {
      window.localStorage.setItem('tahi-theme', 'dark')
    })
    await setupClerkTestingToken({ page })
    const po = createPageObjects({ page, useTestingToken: true, baseURL: baseURL! })

    await page.goto('/sign-in')
    await po.signIn.waitForMounted()

    await expect(page.locator('html')).toHaveClass(/dark/)
    const cardBg = await page
      .locator('.tahi-auth-card')
      .first()
      .evaluate(el => getComputedStyle(el).backgroundColor)
    expect(cardBg).toBe('rgb(255, 255, 255)')

    const body = page.locator('body')
    const scrollWidth = await body.evaluate(el => el.scrollWidth)
    const clientWidth = await body.evaluate(el => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)

    const primaryAction = page
      .locator('.tahi-auth-card .cl-formButtonPrimary, .tahi-auth-card .cl-socialButtonsBlockButton')
      .first()
    const box = await primaryAction.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })
})
