import { test, expect } from '@playwright/test'

/**
 * T164 - Mobile viewport (375px) smoke tests.
 * These tests require a running dev server and a valid Clerk session.
 */

test.describe('Mobile viewport', () => {
  test.skip(true, 'Requires Clerk auth setup for CI')

  test.use({ viewport: { width: 375, height: 812 } })

  test('sidebar is hidden on mobile', async ({ page }) => {
    await page.goto('/overview')
    // The sidebar should have hidden md:flex, so it should not be visible
    const sidebar = page.locator('[data-testid="app-sidebar"]')
    if (await sidebar.count() > 0) {
      await expect(sidebar).not.toBeVisible()
    }
  })

  test('bottom navigation is visible', async ({ page }) => {
    await page.goto('/overview')
    const bottomNav = page.locator('nav.fixed.bottom-0')
    await expect(bottomNav).toBeVisible()
  })

  test('bottom nav has overview, requests, messages links', async ({ page }) => {
    await page.goto('/overview')
    await expect(page.locator('nav.fixed.bottom-0 a[href="/overview"]')).toBeVisible()
    await expect(page.locator('nav.fixed.bottom-0 a[href="/requests"]')).toBeVisible()
    await expect(page.locator('nav.fixed.bottom-0 a[href="/messages"]')).toBeVisible()
  })

  test('requests page renders at 375px without horizontal overflow', async ({ page }) => {
    await page.goto('/requests')
    const body = page.locator('body')
    const scrollWidth = await body.evaluate(el => el.scrollWidth)
    const clientWidth = await body.evaluate(el => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5) // small tolerance
  })

  test('overview page renders at 375px', async ({ page }) => {
    await page.goto('/overview')
    await expect(page.locator('h1')).toBeVisible()
  })

  test('notification bell is accessible on mobile', async ({ page }) => {
    await page.goto('/overview')
    const bell = page.locator('[aria-label*="Notification"]')
    if (await bell.count() > 0) {
      await expect(bell.first()).toBeVisible()
    }
  })

  test('search icon is visible on mobile', async ({ page }) => {
    await page.goto('/overview')
    const searchBtn = page.locator('[aria-label="Search"]')
    if (await searchBtn.count() > 0) {
      await expect(searchBtn.first()).toBeVisible()
    }
  })
})
