import { test, expect, type Page } from '@playwright/test'
import { primePage, shipStudioStorageState, expectNoHorizontalScroll, PHONE_CONTEXT } from './helpers'

/**
 * Site QA (SQA) end to end: add a site, import pages, run a round, scan,
 * tick, read issues, close the round, open the report and archive the site.
 *
 * The QA proxy refuses private upstreams (SSRF guard), so the upstream is the
 * public https://www.tahi.studio and the proxy worker must be reachable by the
 * browser. The spec only runs when E2E_QA_VIEW_ORIGIN (the proxy URL, for
 * example http://localhost:8799) is set. The dashboard under test must be
 * configured with the same proxy origin.
 *
 * Run it (PowerShell), with the dev server on 3000 and the proxy on 8799:
 *   $env:E2E_QA_VIEW_ORIGIN = 'http://localhost:8799'
 *   $env:E2E_BASE_URL = 'http://localhost:3000'
 *   npx playwright test -c playwright.local.config.ts e2e/site-qa.spec.ts --project=chromium --workers=1
 *
 * playwright.local.config.ts has no webServer, so it reuses the running dev
 * server. E2E_BASE_URL overrides the baseURL in that config (default
 * http://localhost:3000 here).
 */

const VIEW_ORIGIN = process.env.E2E_QA_VIEW_ORIGIN
const UPSTREAM = 'https://www.tahi.studio'

test.skip(!VIEW_ORIGIN, 'Set E2E_QA_VIEW_ORIGIN to the QA proxy URL (for example http://localhost:8799) to run the Site QA flow.')

test.use({
  baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  storageState: shipStudioStorageState,
})

test.beforeEach(async ({ page }) => {
  await primePage(page)
})

async function archiveSite(page: Page, siteUrl: string): Promise<void> {
  await page.goto(siteUrl)
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Archive this site?' })
  await confirm.getByRole('button', { name: 'Archive site' }).click()
  await expect(page).toHaveURL(/\/qa\/?(\?.*)?$/, { timeout: 15_000 })
}

test.describe('Site QA', () => {
  test('full flow: add site, import, round, scan, tick, issues, close, report, archive', async ({ page }) => {
    test.setTimeout(240_000)
    const siteName = `E2E QA ${Date.now()}`
    let siteUrl: string | null = null

    try {
      // 1. Add the site through the dialog.
      await page.goto('/qa')
      await page.getByRole('button', { name: 'Add site' }).first().click()
      const dialog = page.getByRole('dialog', { name: /site/i })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('group', { name: 'Client' }).getByRole('button').first().click()
      await page.getByRole('listbox').getByRole('option').first().click()
      await dialog.getByLabel('Name').fill(siteName)
      await dialog.getByLabel('Live URL').fill(UPSTREAM)
      await dialog.getByRole('button', { name: 'Add site' }).click()
      await expect(dialog).toBeHidden()

      // Saving a new site opens its page.
      await expect(page).toHaveURL(/\/qa\/[^/?]+/)
      siteUrl = new URL(page.url()).pathname
      await expect(page.getByRole('heading', { name: siteName, level: 1 })).toBeVisible()

      // 2. Import pages.
      await page.getByRole('button', { name: 'Import pages', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: /pages in the sitemap/ })).toBeVisible({ timeout: 60_000 })

      // 3. Start a round.
      await page.getByRole('button', { name: 'Start round' }).first().click()
      const roundDialog = page.getByRole('dialog', { name: 'Start round' })
      await roundDialog.getByRole('button', { name: 'Start round' }).click()
      await expect(page).toHaveURL(/round=[^&]+/)
      const roundUrl = page.url()

      // 4. Wait for the Desktop frame to finish scanning.
      const desktopBar = page.getByRole('button', { name: /(Expand|Collapse) Desktop preview/ }).locator('..')
      await expect(desktopBar).toContainText('Scanned', { timeout: 120_000 })

      // 5 and 6. Tick XL, reload, still ticked.
      const xlTick = page.getByRole('group', { name: 'Viewport ticks' }).getByRole('checkbox', { name: 'XL' })
      // The tick is optimistic, so wait for the save itself before reloading;
      // a reload mid-request would abort it and prove nothing.
      const saved = page.waitForResponse(r => /\/api\/admin\/qa\/round-pages\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'PATCH')
      await xlTick.check()
      await expect(xlTick).toBeChecked()
      expect((await saved).ok()).toBe(true)
      await page.reload()
      await expect(page.getByRole('group', { name: 'Viewport ticks' }).getByRole('checkbox', { name: 'XL' })).toBeChecked({ timeout: 30_000 })

      // 7. The Issues panel has at least one tab with a count above zero.
      const issuesToggle = page.getByRole('button', { name: 'Issues', exact: true })
      if ((await issuesToggle.getAttribute('aria-expanded')) === 'false') await issuesToggle.click()
      await expect(page.getByRole('tab', { name: /\([1-9]\d*\)/ }).first()).toBeVisible({ timeout: 60_000 })

      // 8. Close the round from Round actions.
      await page.getByRole('button', { name: 'Round actions' }).click()
      await page.getByRole('menuitem', { name: 'Close round' }).click()
      await page.getByRole('dialog', { name: 'Close this round?' }).getByRole('button', { name: 'Close round' }).click()
      await expect(page.getByRole('note').filter({ hasText: 'This round is closed' })).toBeVisible()
      await expect(page.getByRole('group', { name: 'Viewport ticks' }).getByRole('checkbox', { name: 'XL' })).toBeDisabled()

      // 9. Open the report.
      await page.getByRole('button', { name: 'Round actions' }).click()
      await page.getByRole('menuitem', { name: 'Open report' }).click()
      await expect(page).toHaveURL(/\/qa\/rounds\/[^/]+\/report/)
      await expect(page.getByRole('heading', { name: siteName, level: 1 })).toBeVisible({ timeout: 30_000 })
      expect(roundUrl).toContain('round=')
    } finally {
      // 10. Clean up, even when an assertion above failed.
      if (siteUrl) await archiveSite(page, siteUrl)
    }
  })

  test.describe('at 375px', () => {
    test.use(PHONE_CONTEXT)

    test('the workspace does not scroll sideways and shows one frame', async ({ page }) => {
      test.setTimeout(240_000)
      const siteName = `E2E QA mobile ${Date.now()}`
      let siteUrl: string | null = null

      try {
        await page.goto('/qa')
        await page.getByRole('button', { name: 'Add site' }).first().click()
        const dialog = page.getByRole('dialog', { name: /site/i })
        await dialog.getByRole('group', { name: 'Client' }).getByRole('button').first().click()
        await page.getByRole('listbox').getByRole('option').first().click()
        await dialog.getByLabel('Name').fill(siteName)
        await dialog.getByLabel('Live URL').fill(UPSTREAM)
        await dialog.getByRole('button', { name: 'Add site' }).click()
        await expect(dialog).toBeHidden()
        // Saving a new site opens its page.
        await expect(page).toHaveURL(/\/qa\/[^/?]+/)
        siteUrl = new URL(page.url()).pathname

        await page.getByRole('button', { name: 'Import pages', exact: true }).click()
        await expect(page.getByRole('status').filter({ hasText: /pages in the sitemap/ })).toBeVisible({ timeout: 60_000 })
        await page.getByRole('button', { name: 'Start round' }).first().click()
        await page.getByRole('dialog', { name: 'Start round' }).getByRole('button', { name: 'Start round' }).click()
        await expect(page).toHaveURL(/round=[^&]+/)

        const frames = page.getByTitle(/ preview$/)
        await expect(frames.first()).toBeVisible({ timeout: 30_000 })
        const visibleFrames = await frames.evaluateAll(els =>
          els.filter(el => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0
          }).length,
        )
        expect(visibleFrames).toBe(1)
        await expectNoHorizontalScroll(page)
      } finally {
        if (siteUrl) await archiveSite(page, siteUrl)
      }
    })
  })
})
