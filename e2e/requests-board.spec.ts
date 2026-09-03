import { test, expect, type Page } from '@playwright/test'

/**
 * Requests board surfaces: kanban, workload, timeline (Slice C of the
 * Requests alignment pass).
 *
 * Auth: the dev-only Ship Studio bypass (tahi-ship-studio cookie), the same
 * fixture e2e/requests.spec.ts uses. It resolves to the Tahi admin org, so
 * everything here runs as an admin on both the chromium and mobile-safari
 * (iPhone 13) projects.
 *
 * COVERAGE WARNING. The four peer views are gated to super admins
 * (`usePermissions().isSuperAdmin`) and the bypass user's resolved level is
 * not guaranteed, so every test checks the switcher exists first and skips
 * with a reason rather than failing. A green run of this file therefore does
 * not mean the board was exercised: read the skip reasons. Once the lead
 * flips that gate the skips turn into real coverage with no edit here.
 *
 * Nothing in this file writes. The quick-add composer is opened and
 * cancelled, never submitted, so a run leaves no requests behind.
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

/**
 * The product tour paints a fixed, full-viewport overlay at z-index 10000
 * 1500ms after the first authed page load of a fresh context, and every
 * click after that lands on the overlay instead of the page. Marking it
 * complete in localStorage before any navigation is what keeps this file
 * from being a coin toss. addInitScript has to run before goto, so it lives
 * in a beforeEach rather than inside the navigation helper.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('tahi-tour-complete', '1')
    window.localStorage.setItem('tahi-tour-seen', '1')
  })
})

function viewTabs(page: Page) {
  return page.getByRole('tablist', { name: 'Requests view' })
}

async function railIsOn(page: Page): Promise<boolean> {
  return (await viewTabs(page).count()) > 0
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** One kanban column, named by the status it groups rather than by a
 *  control inside it (a column that takes no new work has no control). */
function column(page: Page, status: string) {
  return page.locator(`[data-board-column][data-column-status="${status}"]`)
}

async function gotoRequests(page: Page): Promise<void> {
  await page.goto('/requests')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Requests', { timeout: 20_000 })
}

/** Switch to a peer view, or skip when this audience is not offered it. */
async function openView(page: Page, name: string): Promise<void> {
  test.skip(!(await railIsOn(page)), 'The peer views are super-admin gated; the bypass user is not one.')
  const tab = viewTabs(page).getByRole('tab', { name, exact: true })
  test.skip((await tab.count()) === 0, `${name} view not offered to this audience.`)
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

test.describe('Requests board', () => {
  test('the kanban carries a column per pipeline status, On Hold included', async ({ page }) => {
    await gotoRequests(page)
    await openView(page, 'Kanban')

    for (const status of ['submitted', 'in_review', 'in_progress', 'client_review', 'on_hold', 'delivered']) {
      await expect(column(page, status)).toBeVisible({ timeout: 10_000 })
    }
    await expectNoHorizontalScroll(page)
  })

  test('the intake column is marked as triage', async ({ page }) => {
    await gotoRequests(page)
    await openView(page, 'Kanban')

    // Scoped to the board: "Triage" is also a saved view in the rail, and
    // the point of this test is the marker over the intake column.
    await expect(column(page, 'submitted').getByText('Triage', { exact: true }))
      .toBeVisible({ timeout: 10_000 })
  })

  test('a column the POST would reject offers no add at all', async ({ page }) => {
    await gotoRequests(page)
    await openView(page, 'Kanban')

    // A client can rename or drop columns through custom kanban columns, so
    // the closed column is only asserted on when this board has one.
    const closed = column(page, 'delivered')
    await expect(column(page, 'submitted')).toBeVisible({ timeout: 10_000 })
    test.skip((await closed.count()) === 0, 'This board has no Delivered column.')

    // Delivered and cancelled carry side effects the create route does not
    // run, so nothing may be born there. The column says so by offering no
    // control rather than by failing on submit.
    await expect(closed.getByRole('button', { name: /^Add / })).toHaveCount(0)
  })

  test('quick-add opens a composer and Escape closes it without writing', async ({ page }) => {
    await gotoRequests(page)
    await openView(page, 'Kanban')

    // Named loosely: a client can rename the intake column, and the label
    // follows the column's own name.
    const add = column(page, 'submitted').getByRole('button', { name: /^Add card to / })
    // Quick-add only offers itself when the board knows which client to
    // write against: the rail's client filter, or a board whose cards all
    // belong to one org. Neither is guaranteed in this dataset.
    test.skip((await add.count()) === 0, 'This board cannot resolve a single client to write against.')
    await add.first().click()

    const composer = page.getByRole('textbox', { name: /New request in/ }).first()
    await expect(composer).toBeFocused()
    await composer.fill('Never submitted, e2e only')
    await page.keyboard.press('Escape')
    await expect(composer).toBeHidden({ timeout: 10_000 })
  })

  test('an empty column offers a slot, not a disabled control', async ({ page }) => {
    await gotoRequests(page)
    await openView(page, 'Kanban')

    const slot = page.locator('.tahi-kanban-scroller').getByText('Drop here', { exact: true }).first()
    test.skip((await slot.count()) === 0, 'Every column has cards in this dataset.')

    // A slot is a place to drop, so it must not be a button at all: a
    // disabled one would advertise an action that does not exist.
    expect(await slot.evaluate(el => el.closest('button') !== null)).toBe(false)
  })

  test('the workload view measures against a capacity', async ({ page }) => {
    await gotoRequests(page)
    await openView(page, 'Workload')

    await expect(page.getByText('Team load, open work only')).toBeVisible({ timeout: 10_000 })
    // Every card reads "n / 5", so the number is a load, not a ranking.
    const bars = page.getByRole('progressbar')
    if (await bars.count()) {
      await expect(bars.first()).toHaveAttribute('aria-valuemax', '5')
    }
    await expectNoHorizontalScroll(page)
  })

  test('the timeline plots undated work and can jump to today', async ({ page }) => {
    await gotoRequests(page)
    await openView(page, 'Timeline')

    // The legend names the tones, including the hollow marker undated work
    // plots as. It renders unconditionally, so it is chrome, not evidence.
    await expect(page.getByText('No due date', { exact: true })).toBeVisible({ timeout: 10_000 })

    // The evidence is that nothing falls off the chart: T1's claim is that a
    // request with no due date still plots (hollow, on the day it was
    // raised) rather than being dropped. One marker per row proves it
    // whatever the dataset holds.
    const rows = page.locator('.tahi-tl-row')
    const rowCount = await rows.count()
    test.skip(rowCount === 0, 'No requests to plot in this dataset.')
    await expect(page.locator('[data-timeline-marker]')).toHaveCount(rowCount)
    const undated = page.locator('[data-timeline-marker="undated"]')
    if (await undated.count()) await expect(undated.first()).toBeVisible()

    const today = page.getByRole('button', { name: 'Today', exact: true })
    if (await today.count()) await today.click()
    await expectNoHorizontalScroll(page)
  })
})
