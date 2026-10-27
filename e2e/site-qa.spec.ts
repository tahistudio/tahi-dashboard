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

/** Adds a site on the public upstream, imports its sitemap and starts a round. Returns the site path. */
async function startRound(page: Page, label: string): Promise<string> {
  await page.goto('/qa')
  await page.getByRole('button', { name: 'Add site' }).first().click()
  const dialog = page.getByRole('dialog', { name: /site/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('group', { name: 'Client' }).getByRole('button').first().click()
  await page.getByRole('listbox').getByRole('option').first().click()
  await dialog.getByLabel('Name').fill(`E2E QA ${label} ${Date.now()}`)
  await dialog.getByLabel('Live URL').fill(UPSTREAM)
  await dialog.getByRole('button', { name: 'Add site' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/qa\/[^/?]+/)
  const siteUrl = new URL(page.url()).pathname
  await page.getByRole('button', { name: 'Import pages', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /pages in the sitemap/ })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Start round' }).first().click()
  await page.getByRole('dialog', { name: 'Start round' }).getByRole('button', { name: 'Start round' }).click()
  await expect(page).toHaveURL(/round=[^&]+/)
  return siteUrl
}

/** Writes a screenshot when E2E_QA_SHOTS_DIR is set (for example test-results/sqa11). */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_QA_SHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` })
}

test.describe('Site QA wide mode', () => {
  test('five frames fit without sideways scroll and Actual size appears only when it fits', async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 4600, height: 1400 })
    let siteUrl: string | null = null
    try {
      siteUrl = await startRound(page, 'wide')
      const frames = page.getByTitle(/ preview$/)
      await expect(frames).toHaveCount(5, { timeout: 30_000 })

      await page.getByRole('button', { name: 'Wide', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Exit wide' })).toHaveAttribute('aria-pressed', 'true')
      await expect(frames).toHaveCount(5)
      for (const title of ['XL preview', 'Desktop preview', 'Tablet preview', 'Mobile L preview', 'Mobile P preview']) {
        await expect(page.getByTitle(title)).toBeVisible()
      }
      await expectNoHorizontalScroll(page)
      // Every frame ends above the bottom of the window (the wide height cap).
      const bottoms = await frames.evaluateAll(els => els.map(el => el.getBoundingClientRect().bottom))
      for (const bottom of bottoms) expect(bottom).toBeLessThanOrEqual(1400)

      const zoom = page.getByRole('group', { name: 'Preview zoom' })
      await expect(zoom.getByRole('button', { name: 'Fit width' })).toBeVisible()
      await expect(zoom.getByRole('button', { name: 'Actual size' })).toHaveCount(0)
      await shot(page, 'wide-4600')

      await page.setViewportSize({ width: 5200, height: 1400 })
      await expect(zoom.getByRole('button', { name: 'Actual size' })).toBeVisible({ timeout: 10_000 })
      await shot(page, 'wide-5200')

      // Escape leaves wide mode.
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Wide', exact: true })).toHaveAttribute('aria-pressed', 'false')
    } finally {
      await page.evaluate(() => window.localStorage.removeItem('tahi-qa-wide')).catch(() => undefined)
      if (siteUrl) await archiveSite(page, siteUrl)
    }
  })
})

test.describe('Site QA element comments', () => {
  test('pick an element, save a comment, then resolve and delete it', async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 1920, height: 1100 })
    let siteUrl: string | null = null
    try {
      siteUrl = await startRound(page, 'comments')
      // The scanner is attached once the Desktop frame has scanned.
      const desktopBar = page.getByRole('button', { name: /(Expand|Collapse) Desktop preview/ }).locator('..')
      await expect(desktopBar).toContainText('Scanned', { timeout: 120_000 })

      const toggle = page.getByRole('button', { name: 'Comment on Desktop' })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      // Only one frame is in comment mode at a time.
      await page.getByRole('button', { name: 'Comment on Tablet' }).click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')

      // Click an element inside the Desktop frame; the scanner posts a qa:pick.
      const target = page.frameLocator('iframe[title="Desktop preview"]').locator('h1, h2, p').first()
      await target.click({ force: true })
      const composer = page.getByRole('dialog', { name: 'Add comment' })
      await expect(composer).toBeVisible({ timeout: 15_000 })
      await shot(page, 'comment-composer')
      await composer.getByRole('textbox').fill('E2E: tighten this heading\nsecond line')
      await composer.getByRole('button', { name: 'Save' }).click()
      await expect(composer).toBeHidden({ timeout: 20_000 })
      // Comment mode stays on for the next pick.
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')

      // The Issues panel shows the new comment.
      const issuesToggle = page.getByRole('button', { name: 'Issues', exact: true })
      if ((await issuesToggle.getAttribute('aria-expanded')) === 'false') await issuesToggle.click()
      const tab = page.getByRole('tab', { name: 'Comments (1 open)' })
      await expect(tab).toBeVisible()
      await tab.click()
      const item = page.getByRole('listitem').filter({ hasText: 'E2E: tighten this heading' })
      await expect(item).toBeVisible()
      await shot(page, 'comment-listed')

      await item.getByRole('button', { name: 'Resolve' }).click()
      await expect(page.getByRole('tab', { name: 'Comments (0 open)' })).toBeVisible()
      await page.getByRole('button', { name: 'Resolved', exact: true }).click()
      const resolved = page.getByRole('listitem').filter({ hasText: 'E2E: tighten this heading' })
      await expect(resolved.getByRole('button', { name: 'Reopen' })).toBeVisible()

      await resolved.getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('dialog', { name: 'Delete this comment?' }).getByRole('button', { name: 'Delete comment' }).click()
      await expect(page.getByText('E2E: tighten this heading')).toHaveCount(0)

      // Escape turns comment mode off.
      await page.keyboard.press('Escape')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    } finally {
      if (siteUrl) await archiveSite(page, siteUrl)
    }
  })
})


test.describe('Site QA synced scroll', () => {
  test('scrolling one frame moves the others, and the toggle frees them', async ({ page }) => {
    test.setTimeout(300_000)
    await page.setViewportSize({ width: 4600, height: 1400 })
    let siteUrl: string | null = null
    try {
      siteUrl = await startRound(page, 'sync')
      // Every visible frame has scanned, so its scanner is attached and has heard the sync state.
      for (const name of ['Desktop', 'Tablet']) {
        const bar = page.getByRole('button', { name: new RegExp(`(Expand|Collapse) ${name} preview`) }).locator('..')
        await expect(bar).toContainText('Scanned', { timeout: 120_000 })
      }
      await page.getByRole('button', { name: 'Wide', exact: true }).click()
      const sync = page.getByRole('button', { name: 'Sync scroll' })
      await expect(sync).toHaveAttribute('aria-pressed', 'true')

      const scrollY = (title: string) => page.frameLocator(`iframe[title="${title}"]`).locator('html').evaluate(() => window.scrollY)
      const wheelOver = async (title: string, dy: number) => {
        const box = await page.getByTitle(title).boundingBox()
        if (!box) throw new Error(`no box for ${title}`)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.wheel(0, dy)
      }

      expect(await scrollY('Tablet preview')).toBe(0)
      await wheelOver('Desktop preview', 700)
      await expect.poll(() => scrollY('Tablet preview'), { timeout: 2000 }).toBeGreaterThan(0)
      await expect.poll(() => scrollY('Mobile P preview'), { timeout: 2000 }).toBeGreaterThan(0)
      // Aligned: the section under each frame's probe line (15% down) has the same index in all five.
      const sectionIndex = (title: string) => page.frameLocator(`iframe[title="${title}"]`).locator('html').evaluate(() => {
        const hits = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight * 0.15)
        for (const el of hits) {
          let node: Element | null = el
          let fixed = false
          while (node && node !== document.body && node !== document.documentElement) {
            const pos = getComputedStyle(node).position
            if (pos === 'fixed' || pos === 'sticky') fixed = true
            node = node.parentElement
          }
          if (fixed) continue
          const section = el.closest('section')
          return section ? Array.from(document.querySelectorAll('section')).indexOf(section) : -1
        }
        return -1
      })
      const titles = ['XL preview', 'Desktop preview', 'Tablet preview', 'Mobile L preview', 'Mobile P preview']
      await expect.poll(async () => {
        const indexes = await Promise.all(titles.map(sectionIndex))
        return new Set(indexes).size === 1 && indexes[0] >= 0 ? 'aligned' : indexes.join(',')
      }, { timeout: 5000 }).toBe('aligned')
      await shot(page, 'sync-scroll-on')

      // Free scrolling: the other frames stay where they are.
      await sync.click()
      await expect(sync).toHaveAttribute('aria-pressed', 'false')
      const tabletBefore = await scrollY('Tablet preview')
      await wheelOver('Desktop preview', 700)
      await page.waitForTimeout(1500)
      expect(await scrollY('Tablet preview')).toBe(tabletBefore)
      await shot(page, 'sync-scroll-off')

      // The choice is remembered.
      expect(await page.evaluate(() => window.localStorage.getItem('tahi-qa-sync-scroll'))).toBe('false')
    } finally {
      await page.evaluate(() => {
        window.localStorage.removeItem('tahi-qa-wide')
        window.localStorage.removeItem('tahi-qa-sync-scroll')
      }).catch(() => undefined)
      if (siteUrl) await archiveSite(page, siteUrl)
    }
  })
})
