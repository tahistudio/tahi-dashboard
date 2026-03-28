import { test, expect } from '@playwright/test'

/**
 * T162 - Admin flow smoke tests.
 * These tests require a running dev server and a valid Clerk admin session.
 * Set CLERK_TEST_TOKEN or use Clerk testing helpers for auth.
 */

test.describe('Admin flow', () => {
  test.skip(true, 'Requires Clerk auth setup for CI')

  test('can navigate to overview page', async ({ page }) => {
    await page.goto('/overview')
    await expect(page.locator('h1')).toContainText('Overview')
  })

  test('can navigate to clients page', async ({ page }) => {
    await page.goto('/clients')
    await expect(page.locator('h1')).toContainText('Clients')
  })

  test('can navigate to requests page', async ({ page }) => {
    await page.goto('/requests')
    await expect(page.locator('h1')).toContainText('Requests')
  })

  test('can open new client dialog', async ({ page }) => {
    await page.goto('/clients')
    await page.click('button:has-text("New Client")')
    await expect(page.locator('[role="dialog"]')).toBeVisible()
  })

  test('can open new request dialog', async ({ page }) => {
    await page.goto('/requests')
    await page.click('button:has-text("New Request")')
    await expect(page.locator('[role="dialog"]')).toBeVisible()
  })

  test('can toggle between list and board view', async ({ page }) => {
    await page.goto('/requests')
    await page.click('[aria-label="Board view"]')
    // Board columns should be visible
    await expect(page.locator('text=Submitted')).toBeVisible()
    await page.click('[aria-label="List view"]')
  })

  test('can navigate to a request detail', async ({ page }) => {
    await page.goto('/requests')
    const firstRequest = page.locator('a[href^="/requests/"]').first()
    if (await firstRequest.isVisible()) {
      await firstRequest.click()
      await expect(page.url()).toContain('/requests/')
    }
  })

  test('can navigate to invoices page', async ({ page }) => {
    await page.goto('/invoices')
    await expect(page.locator('h1')).toContainText('Invoices')
  })

  test('can navigate to reports page', async ({ page }) => {
    await page.goto('/reports')
    await expect(page.locator('h1')).toContainText('Reports')
  })

  test('can navigate to team page', async ({ page }) => {
    await page.goto('/team')
    await expect(page.locator('h1')).toContainText('Team')
  })
})
