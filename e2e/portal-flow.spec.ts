import { test, expect } from '@playwright/test'

/**
 * T163 - Client portal smoke tests.
 * These tests require a running dev server and a valid Clerk client session.
 * Set CLERK_TEST_TOKEN or use Clerk testing helpers for auth.
 */

test.describe('Portal flow', () => {
  test.skip(true, 'Requires Clerk auth setup for CI')

  test('can view portal overview', async ({ page }) => {
    await page.goto('/overview')
    await expect(page.locator('h1')).toBeVisible()
  })

  test('can view requests list', async ({ page }) => {
    await page.goto('/requests')
    await expect(page.locator('h1')).toContainText('Requests')
  })

  test('can view request detail', async ({ page }) => {
    await page.goto('/requests')
    const firstRequest = page.locator('a[href^="/requests/"]').first()
    if (await firstRequest.isVisible()) {
      await firstRequest.click()
      await expect(page.url()).toContain('/requests/')
    }
  })

  test('can view messages', async ({ page }) => {
    await page.goto('/messages')
    await expect(page.locator('h1')).toContainText('Messages')
  })

  test('can view invoices', async ({ page }) => {
    await page.goto('/invoices')
    await expect(page.locator('h1')).toContainText('Invoices')
  })

  test('can access profile/settings', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator('h1')).toBeVisible()
  })

  test('can submit a new request', async ({ page }) => {
    await page.goto('/requests')
    const newBtn = page.locator('button:has-text("New Request")')
    if (await newBtn.isVisible()) {
      await newBtn.click()
      await expect(page.locator('[role="dialog"]')).toBeVisible()
    }
  })
})
