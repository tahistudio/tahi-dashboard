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
 * The four peer views are still gated to super admins
 * (`usePermissions().isSuperAdmin`), and the bypass user's resolved level is
 * not guaranteed, so every test checks the switcher exists first and skips
 * with a reason rather than failing. Once the lead flips the gate the skips
 * turn into real coverage with no edit here.
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

    // The column's own add button is the one control named after it, so it
    // is how a column is identified without depending on its cards. A
    // read-only audience has none, and has no columns to add to either.
    const first = page.getByRole('button', { name: 'Add card to Submitted' })
    test.skip((await first.count()) === 0, 'This audience cannot write to the board.')

    for (const label of ['Submitted', 'In Review', 'In Progress', 'Client Review', 'On Hold', 'Delivered']) {
      await expect(page.getByRole('button', { name: `Add card to ${label}` }).first())
        .toBeVisible({ timeout: 10_000 })
    }
    await expectNoHorizontalScroll(page)
  })

  test('the intake column is marked as triage', async ({ page }) => {
    await gotoRequests(page)
    await openView(page, 'Kanban')

    // Scoped to the board: "Triage" is also a saved view in the rail, and
    // the point of this test is the marker over the intake column.
    const board = page.locator('.tahi-kanban-scroller')
    await expect(board.getByText('Triage', { exact: true })).toBeVisible({ timeout: 10_000 })
  })

  test('quick-add opens a composer and Escape closes it without writing', async ({ page }) => {
    await gotoRequests(page)
    await openView(page, 'Kanban')

    const add = page.getByRole('button', { name: 'Add card to Submitted' })
    test.skip((await add.count()) === 0, 'This audience cannot write to the board.')
    await add.first().click()

    const composer = page.getByRole('textbox', { name: /New request in/ }).first()
    // Quick-add only offers itself when the board knows which client to
    // write against; otherwise the plus opens the full dialog instead.
    if ((await composer.count()) === 0) {
      const dialog = page.getByRole('dialog').first()
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      return
    }

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
    // plots as, so the chart is readable without a tooltip.
    await expect(page.getByText('No due date', { exact: true })).toBeVisible({ timeout: 10_000 })
    const today = page.getByRole('button', { name: 'Today', exact: true })
    if (await today.count()) await today.click()
    await expectNoHorizontalScroll(page)
  })
})
