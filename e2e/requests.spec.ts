import { test, expect, type Page } from '@playwright/test'

/**
 * Requests happy path (Slice 8 of the Requests TSX port).
 *
 * Auth: the dev-only Ship Studio bypass (tahi-ship-studio cookie), the same
 * fixture e2e/settings-smoke.spec.ts uses. It resolves to the Tahi admin org,
 * so everything here runs as an admin on both the chromium and mobile-safari
 * (iPhone 13) projects.
 *
 * The rail toolbar, the four peer views and the delivery spine are still gated
 * to super admins (`usePermissions().isSuperAdmin`). The bypass user's resolved
 * permission level is not guaranteed, so every test that needs the new UI
 * checks for it first and skips with a clear reason rather than failing. Once
 * the lead flips the gate, those skips turn into real coverage with no edit
 * here.
 *
 * Data resilience: the specs assert on chrome (tabs, dialogs, spine), never on
 * a particular request existing. Anything that needs a row bails out early when
 * the list is empty.
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

/** The rail view switcher only mounts for super admins. */
function viewTabs(page: Page) {
  return page.getByRole('tablist', { name: 'Requests view' })
}

async function railIsOn(page: Page): Promise<boolean> {
  return (await viewTabs(page).count()) > 0
}

/** The page body must never scroll sideways (CLAUDE.md Definition of Done). */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** Rows in the list, whichever view chrome is mounted. */
function requestLinks(page: Page) {
  return page.locator('a[href^="/requests/"]')
}

async function gotoRequests(page: Page): Promise<void> {
  await page.goto('/requests')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Requests', { timeout: 20_000 })
}

test.describe('Requests', () => {
  test('the list page loads with no horizontal scroll', async ({ page }) => {
    await gotoRequests(page)
    await expectNoHorizontalScroll(page)
  })

  test('the four peer views each render', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await railIsOn(page)), 'Rail UI is super-admin gated; the bypass user is not one.')

    // Workload is a Tahi-only cut, so a client audience sees three tabs.
    for (const name of ['List', 'Kanban', 'Workload', 'Timeline']) {
      const tab = viewTabs(page).getByRole('tab', { name, exact: true })
      if ((await tab.count()) === 0) continue

      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      // The header stays put across views, so it is the one thing every view
      // must still be rendering once the switch has settled.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoHorizontalScroll(page)
    }

    // Leave the surface on List so a re-run starts from a known state.
    const list = viewTabs(page).getByRole('tab', { name: 'List', exact: true })
    if (await list.count()) await list.click()
  })

  test('a row with sub-requests expands in place', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await railIsOn(page)), 'Expandable rows ship with the rail UI.')

    const expand = page.getByRole('button', { name: 'Expand row' }).first()
    test.skip((await expand.count()) === 0, 'No request in this dataset has sub-requests.')

    await expand.click()
    await expect(page.getByRole('button', { name: 'Collapse row' }).first()).toBeVisible()
  })

  test('the new request dialog opens and closes', async ({ page }) => {
    await gotoRequests(page)

    // The label collapses to "New" below the sm breakpoint (mobile-safari).
    await page.getByRole('button', { name: /^New( request)?$/i }).first().click()
    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  })

  test('a request detail opens and shows the delivery spine', async ({ page }) => {
    await gotoRequests(page)

    const first = requestLinks(page).first()
    test.skip((await first.count()) === 0, 'No requests in this dataset.')

    await first.click()
    await expect(page).toHaveURL(/\/requests\/[^/]+$/, { timeout: 20_000 })

    // The detail rebuild is behind the same super-admin flag as the rail, so
    // the spine is absent rather than broken when the gate is closed.
    const spine = page.getByRole('list', { name: 'Delivery steps' })
    await page.waitForLoadState('networkidle')
    test.skip((await spine.count()) === 0, 'Delivery spine is super-admin gated.')

    await expect(spine).toBeVisible({ timeout: 20_000 })
    // Every pipeline status gets a step, so the spine is never a single item.
    expect(await spine.getByRole('listitem').count()).toBeGreaterThan(1)
    await expectNoHorizontalScroll(page)
  })

  test('keyboard focus paints the shared ring', async ({ page }) => {
    await gotoRequests(page)

    // Walk in from the top of the document until focus lands on a control that
    // opts into the shared ring. Asserting on the class rather than a named
    // button keeps this honest whichever toolbar is mounted.
    let found = false
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('Tab')
      found = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return false
        if (!el.classList.contains('tahi-focus-ring')) return false
        if (!el.matches(':focus-visible')) return false
        const shadow = getComputedStyle(el).boxShadow
        return shadow !== 'none' && shadow.length > 0
      })
    }
    expect(found).toBe(true)
  })

  test('a mouse click leaves no ring behind', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await railIsOn(page)), 'Needs a side-effect-free control; the view tabs are gated.')

    // Switching view is the one click on this page with no dialog, no
    // navigation and no write, so it is safe to assert focus state after it.
    const kanban = viewTabs(page).getByRole('tab', { name: 'Kanban', exact: true })
    test.skip((await kanban.count()) === 0, 'Kanban view not offered to this audience.')

    await kanban.click()
    const state = await kanban.evaluate(el => ({
      focused: el === document.activeElement,
      focusVisible: el.matches(':focus-visible'),
    }))
    expect(state.focused).toBe(true)
    expect(state.focusVisible).toBe(false)
  })
})
