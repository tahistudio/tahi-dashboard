import { test, expect } from '@playwright/test'

/**
 * Settings control-room smoke (the imported Tahi Settings design).
 *
 * Auth: the dev-only Ship Studio bypass (tahi-ship-studio cookie) - the same
 * mechanism e2e/helpers/invites.ts uses. It resolves to the Tahi admin org,
 * so these tests cover the admin surface on both the chromium and
 * mobile-safari (iPhone 13) projects. Client-audience settings are covered by
 * the portal specs + unit tests; the invite flow itself by onboarding-personas.
 */

test.use({
  storageState: {
    cookies: [
      {
        name: 'tahi-ship-studio',
        value: '1',
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  },
})

function isMobile(viewport: { width: number } | null): boolean {
  return !!viewport && viewport.width < 768
}

test.describe('Settings control room', () => {
  test('renders the grouped IA with no horizontal scroll', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator('.set-h2').first()).toBeVisible({ timeout: 15_000 })

    if (isMobile(page.viewportSize())) {
      // Mobile: the sub-nav collapses to the section picker.
      await expect(page.locator('.set-mselect')).toBeVisible()
      // Touch target: the picker must be at least 44px tall.
      const box = await page.locator('.set-mselect').boundingBox()
      expect(box && box.height).toBeGreaterThanOrEqual(44)
    } else {
      await expect(page.locator('.set-nav')).toBeVisible()
      for (const group of ['Account', 'Workspace', 'Intake & boards', 'Sales & pipeline']) {
        await expect(page.locator('.set-navlabel', { hasText: group })).toBeVisible()
      }
    }

    // The page body must never scroll horizontally (Definition of Done).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('deep link ?section= selects that section and switching updates the URL', async ({ page }) => {
    await page.goto('/settings?section=stages')
    await expect(page.locator('.set-h2')).toContainText('Pipeline stages', { timeout: 15_000 })

    if (!isMobile(page.viewportSize())) {
      await page.locator('.set-navitem', { hasText: 'Pipeline defaults' }).click()
      await expect(page.locator('.set-h2')).toContainText('Pipeline defaults')
      await expect(page).toHaveURL(/section=pipedef/)
    }
  })

  test('Team & access pane: tabs, list, matrix columns', async ({ page }) => {
    // /permissions renders the same pane and is admin+ (not super-admin-gated),
    // so it is stable regardless of the bypass user's resolved level.
    await page.goto('/permissions')
    await expect(page.locator('.set-h2')).toContainText('Team & access', { timeout: 15_000 })

    // Tabs + search + history link (the design switchrow).
    for (const tab of ['Team members', 'Clients', 'Roles']) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Change history' })).toBeVisible()

    // Roles matrix: role columns render from the live matrix API.
    await page.getByRole('tab', { name: 'Roles' }).click()
    const matrix = page.locator('.mx')
    await expect(matrix).toBeVisible({ timeout: 15_000 })
    for (const role of ['Super admin', 'Admin', 'Project manager', 'Task handler', 'Viewer']) {
      // Anchored regex: 'Admin' must not also match the 'Super admin' header.
      await expect(matrix.locator('th', { hasText: new RegExp('^' + role + '$') })).toBeVisible()
    }

    // Change history view opens (audit-backed).
    await page.getByRole('button', { name: 'Change history' }).click()
    await expect(page.locator('.hist')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.hist thead')).toContainText('Reason')
  })
})
