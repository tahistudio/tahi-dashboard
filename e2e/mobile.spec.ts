import { test, expect } from '@playwright/test'
import { primePage } from './helpers'

/**
 * T164 - Mobile viewport (375px) smoke tests.
 * These tests require a running dev server and a valid Clerk session.
 */

test.describe('Mobile viewport', () => {
  test.skip(true, 'Requires Clerk auth setup for CI')

  test.use({ viewport: { width: 375, height: 812 } })

  test.beforeEach(async ({ page }) => { await primePage(page) })

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
    const bottomNav = page.getByRole('navigation', { name: 'Primary', exact: true })
      .filter({ has: page.getByRole('button', { name: 'Open full navigation menu' }) })
    await expect(bottomNav).toBeVisible()
  })

  test('client bottom nav has overview, requests and files, with Messages hidden by default', async ({ page }) => {
    await page.goto('/overview')
    const bottomNav = page.getByRole('navigation', { name: 'Primary', exact: true })
      .filter({ has: page.getByRole('button', { name: 'Open full navigation menu' }) })
    await expect(bottomNav.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()
    await expect(bottomNav.getByRole('link', { name: 'Requests', exact: true })).toBeVisible()
    await expect(bottomNav.getByRole('link', { name: 'Files', exact: true })).toBeVisible()
    await expect(bottomNav.locator('a[href="/messages"]')).toHaveCount(0)

    await bottomNav.getByRole('button', { name: 'Open full navigation menu' }).click()
    const moreMenu = page.getByRole('dialog', { name: 'More navigation' })
    await expect(moreMenu).toBeVisible()
    await expect(moreMenu.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible()
    await expect(moreMenu.getByRole('link', { name: 'How this works', exact: true })).toBeVisible()
    await expect(moreMenu.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
    await expect(moreMenu.locator('a[href="/messages"]')).toHaveCount(0)
    await expect(moreMenu.locator('a[href="/services"]')).toHaveCount(0)
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
