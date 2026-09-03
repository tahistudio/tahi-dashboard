import { test, expect, type Page } from '@playwright/test'

/**
 * Requests LIST surface (the alignment pass, audit findings A1 to A13).
 *
 * Auth: the dev-only Ship Studio bypass (tahi-ship-studio cookie), the same
 * fixture e2e/requests.spec.ts and e2e/settings-smoke.spec.ts use. It resolves
 * to the Tahi admin org, so everything here runs as an admin on both the
 * chromium and mobile-safari (iPhone 13) projects.
 *
 * The rail toolbar and the list it wraps are still gated to super admins
 * (`usePermissions().isSuperAdmin`), so every case that needs the new UI
 * checks for it first and skips with a clear reason rather than failing. Once
 * the lead flips the gate, those skips turn into real coverage with no edit
 * here.
 *
 * Data resilience: these assert on chrome, never on a particular request
 * existing. Anything that needs a row bails out early when the list is empty.
 *
 * The happy path (page loads, four views render, dialog opens, detail opens)
 * lives in e2e/requests.spec.ts and is deliberately not repeated here.
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

/** True on the mobile-safari project, where the table is a card list. */
async function isNarrow(page: Page): Promise<boolean> {
  return (await page.evaluate(() => window.innerWidth)) < 768
}

async function gotoRequests(page: Page): Promise<void> {
  await page.goto('/requests')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Requests', { timeout: 20_000 })
}

/** Wait for the list to settle into rows or an empty state. */
async function listSettled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
}

test.describe('Requests list', () => {
  test('the view switcher is one sliding pill', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await railIsOn(page)), 'Rail UI is super-admin gated; the bypass user is not one.')

    // One pill for the whole strip, not a background per button.
    const pill = viewTabs(page).locator('.tahi-seg-pill')
    await expect(pill).toHaveCount(1)

    const list = viewTabs(page).getByRole('tab', { name: 'List', exact: true })
    const kanban = viewTabs(page).getByRole('tab', { name: 'Kanban', exact: true })
    test.skip((await kanban.count()) === 0, 'Kanban view not offered to this audience.')

    // It has settled somewhere real before anyone clicks.
    await expect(pill).toHaveAttribute('data-state', 'ready')
    const atList = await pill.evaluate(el => el.getBoundingClientRect().x)

    await kanban.click()
    await expect(kanban).toHaveAttribute('aria-selected', 'true')
    await expect
      .poll(async () => pill.evaluate(el => el.getBoundingClientRect().x))
      .not.toBe(atList)

    await list.click()
    await expect(list).toHaveAttribute('aria-selected', 'true')
  })

  test('arrow keys move the view selection', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await railIsOn(page)), 'Rail UI is super-admin gated; the bypass user is not one.')

    const list = viewTabs(page).getByRole('tab', { name: 'List', exact: true })
    const kanban = viewTabs(page).getByRole('tab', { name: 'Kanban', exact: true })
    test.skip((await kanban.count()) === 0, 'Kanban view not offered to this audience.')

    await list.click()
    await page.keyboard.press('ArrowRight')
    await expect(kanban).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Home')
    await expect(list).toHaveAttribute('aria-selected', 'true')
  })

  test('the page subtitle orients rather than repeating the count', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await railIsOn(page)), 'The audience subtitle ships with the rail UI.')

    // One of the three audience sentences, never "12 requests".
    await expect(page.getByText(/submit, triage, and deliver|what's yours and what's queued|where each piece stands/))
      .toBeVisible()
  })

  test('a column header sorts, reverses, then clears', async ({ page }) => {
    await gotoRequests(page)
    test.skip(await isNarrow(page), 'The card list below md has no column headers.')
    await listSettled(page)

    const header = page.getByRole('columnheader', { name: /^Request$/ })
    test.skip((await header.count()) === 0, 'List view is not the mounted view.')

    const button = header.getByRole('button').first()
    await button.click()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')

    await button.click()
    await expect(header).toHaveAttribute('aria-sort', 'descending')

    // The third click hands ordering back to the rail's own Sort control.
    await button.click()
    await expect(header).toHaveAttribute('aria-sort', 'none')
  })

  test('shift-clicking a checkbox selects the rows in between', async ({ page }) => {
    await gotoRequests(page)
    test.skip(await isNarrow(page), 'Row checkboxes are a table affordance.')
    await listSettled(page)

    const boxes = page.getByRole('checkbox', { name: /^Select row$/ })
    const count = await boxes.count()
    test.skip(count < 3, 'Needs at least three requests to span a range.')

    await boxes.nth(0).click()
    await boxes.nth(2).click({ modifiers: ['Shift'] })

    // The row in between came with them, so three rows now offer to deselect.
    await expect(page.getByRole('checkbox', { name: 'Deselect row' })).toHaveCount(3)
  })

  test('an expanded row lines its children up with the parent columns', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await railIsOn(page)), 'Expandable rows ship with the rail UI.')
    test.skip(await isNarrow(page), 'Below md the children render as a dot list, not cells.')
    await listSettled(page)

    const expand = page.getByRole('button', { name: 'Expand row' }).first()
    test.skip((await expand.count()) === 0, 'No request in this dataset has sub-requests.')

    await expand.click()
    await expect(page.getByRole('button', { name: 'Collapse row' }).first()).toBeVisible()

    // Every row in the body, parent and child alike, has the same cell count,
    // which is the whole point of rendering children as real <tr>s.
    const cellCounts = await page.evaluate(() => {
      const body = document.querySelector('table tbody')
      if (!body) return []
      return Array.from(body.querySelectorAll('tr')).map(tr => tr.querySelectorAll('td').length)
    })
    const spanning = cellCounts.filter(n => n === 1)
    const gridRows = cellCounts.filter(n => n > 1)
    expect(gridRows.length).toBeGreaterThan(1)
    // The full-width rows are the loading / empty / Add sub-request lines.
    expect(new Set(gridRows).size).toBe(1)
    expect(spanning.length).toBeLessThanOrEqual(cellCounts.length)
  })

  test('the mobile card list replaces the table below md', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await isNarrow(page)), 'Chromium runs at desktop width; this is the phone case.')
    await listSettled(page)

    // No table on screen, and nothing scrolling sideways.
    const tableVisible = await page.evaluate(() => {
      const table = document.querySelector('table')
      if (!table) return false
      const wrap = table.closest('div')
      return !!wrap && getComputedStyle(wrap).display !== 'none'
    })
    expect(tableVisible).toBe(false)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('Save as default is reachable without opening the filter sheet', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await railIsOn(page)), 'Save as default ships with the rail UI.')

    const save = page.getByRole('button', { name: 'Save as default' }).filter({ visible: true })
    const settled = page.getByText('Your default').filter({ visible: true })
    // One or the other is on screen at every width: the rail's foot above lg,
    // the chips row below it. The Filters sheet starts closed either way.
    expect((await save.count()) + (await settled.count())).toBeGreaterThan(0)
  })

  test('a filter that hides everything offers a way back', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await railIsOn(page)), 'The filtered empty state ships with the rail UI.')
    await listSettled(page)

    const search = page.getByRole('textbox', { name: /Search requests/ })
    test.skip((await search.count()) === 0, 'Search box not mounted for this audience.')

    // The card list and the table each carry an empty state; only the one for
    // the current width is on screen, so filter to it rather than guessing.
    const noMatch = page.getByText('No requests match').filter({ visible: true })
    const clear = page.getByRole('button', { name: 'Clear filters' }).filter({ visible: true })

    await search.fill('zzzzz-no-request-has-this-title')
    await expect(noMatch).toBeVisible({ timeout: 10_000 })

    await expect(clear).toBeVisible()
    await clear.click()
    await expect(noMatch).toHaveCount(0, { timeout: 10_000 })
  })
})
