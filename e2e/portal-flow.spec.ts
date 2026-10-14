import { test, expect } from '@playwright/test'
import { primePage } from './helpers'

/**
 * T163 - Client portal smoke tests.
 * These tests require a running dev server and a valid Clerk client session.
 * Set CLERK_TEST_TOKEN or use Clerk testing helpers for auth.
 */

test.describe('Portal flow', () => {
  test.skip(true, 'Requires Clerk auth setup for CI')

  test.beforeEach(async ({ page }) => { await primePage(page) })

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

  test('client default navigation has portal links and hides Messages and Services', async ({ page }) => {
    await page.goto('/overview')
    // Both the desktop rail and phone tabs are mounted. Count links so this
    // assertion works at either viewport without choosing a hidden surface.
    for (const href of ['/overview', '/requests', '/files']) {
      await expect(page.locator(`nav a[href="${href}"]`)).not.toHaveCount(0)
    }
    await expect(page.locator('nav a[href="/messages"]')).toHaveCount(0)
    await expect(page.locator('nav a[href="/services"]')).toHaveCount(0)
    const response = await page.request.get('/api/portal/messages')
    expect(response.status()).toBe(403)
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
