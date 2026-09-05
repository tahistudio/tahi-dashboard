import { test, expect, type Page } from '@playwright/test'
import {
  primePage,
  createTask,
  deleteTask,
  addBlocker,
  removeBlocker,
  listRequests,
  pickPipelineRequest,
} from './helpers'

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
  await viewTabs(page).first().waitFor({ state: 'attached', timeout: 8_000 }).catch(() => {})
  return (await viewTabs(page).count()) > 0
}

/** True on the mobile-safari project, where the table is a card list. */
async function isNarrow(page: Page): Promise<boolean> {
  return (await page.evaluate(() => window.innerWidth)) < 768
}

async function gotoRequests(page: Page): Promise<void> {
  // A dev server compiling a sibling route can reset the first connection,
  // which Chromium reports as an aborted navigation. One retry keeps the
  // spec honest about the page rather than the harness.
  try {
    await page.goto('/requests')
  } catch (err) {
    if (!String(err).includes('ERR_ABORTED')) throw err
    await page.goto('/requests')
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Requests', { timeout: 20_000 })
}

/** DataTable turns pagination on above this many rows and draws one page. */
const PAGE_SIZE = 20

/** The toolbar's count line, the one aria-live number beside the search. It
 *  counts the whole narrowed set; the table below it only draws a page. */
function countLine(page: Page) {
  return page.getByText(/^\d+ requests?$/).first()
}

async function countValue(page: Page): Promise<number> {
  return Number(((await countLine(page).textContent()) ?? '').replace(/\D/g, ''))
}

/**
 * Put one particular request on screen, whatever else is in the database.
 *
 * request-list.tsx hands DataTable no `paginate`, so pagination auto-enables
 * above 20 rows at a page size of 20 (components/tahi/data-table.tsx), while
 * the browser fetches `status=all&limit=500`. Delivered and archived requests
 * updated more recently than the fixture then sit ahead of it and push it onto
 * page two, where `toHaveCount(1)` times out and reports a missing glyph
 * rather than a missing row. The rail's search narrows the whole set rather
 * than the page; where it is not mounted the page size select is the fallback,
 * and where neither exists the list is short enough not to paginate at all.
 */
async function narrowToRequest(page: Page, title: string): Promise<void> {
  const search = page.getByRole('textbox', { name: /Search requests/ })
  if (await search.count()) {
    await search.fill(title)
    return
  }
  const pageSize = page.locator('#pgnsize')
  if (await pageSize.count()) await pageSize.selectOption('all')
}

/** Wait for the list to settle into rows or an empty state. */
async function listSettled(page: Page): Promise<void> {
  // The shell keeps a notification stream open, so networkidle never fires.
  // The table frame is in the DOM before the fetch resolves, so waiting on it
  // handed back an empty tbody and every row-dependent case skipped itself on
  // a populated database. Wait for a row link or the empty state instead.
  await page
    .locator('a[href^="/requests/"]')
    .or(page.getByText('No requests match'))
    .or(page.getByText('No requests found'))
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
    .catch(() => {})
}

test.describe('Requests list', () => {
  // A cold dev server can spend most of the 30s default compiling /requests
  // before the first assertion runs, and the rows arrive after that.
  test.describe.configure({ timeout: 90_000 })

  // A fresh context looks like a first visit, so the product tour spotlight
  // would sit over the page and swallow every click and Tab press below.
  test.beforeEach(async ({ page }) => { await primePage(page) })

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

    // Both names, because a checkbox is renamed the moment it is ticked. A
    // locator that matched "Select row" alone renumbered itself after the
    // first click, so nth(2) walked one row further down and the range came
    // back one row too long.
    const boxes = page.getByRole('checkbox', { name: /^(?:De)?select row$/i })
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

    // The shape of the tbody: one number per row, its cell count. Full-width
    // rows (the loading, empty and Add sub-request lines) read as 1.
    const rowShape = () => page.evaluate(() => {
      const body = document.querySelector('table tbody')
      if (!body) return { cells: [] as number[], spans: [] as number[] }
      const rows = Array.from(body.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td')))
      return {
        cells: rows.map(tds => tds.length),
        spans: rows.filter(tds => tds.length === 1).map(tds => tds[0].colSpan),
      }
    })

    const before = await rowShape()
    await expand.click()
    await expect(page.getByRole('button', { name: 'Collapse row' }).first()).toBeVisible()
    // The panel fetches on mount, so wait for its loading line to clear before
    // measuring anything.
    await expect(page.getByText('Loading sub-requests')).toHaveCount(0, { timeout: 15_000 })
    test.skip(
      (await page.getByText('No sub-requests yet.').count()) > 0,
      'The expanded request turned out to have no sub-requests.',
    )

    const after = await rowShape()
    const gridBefore = before.cells.filter(n => n > 1)
    const gridAfter = after.cells.filter(n => n > 1)

    // Children arrived as real grid rows, not as one full-width panel.
    expect(gridBefore.length).toBeGreaterThan(0)
    expect(gridAfter.length).toBeGreaterThan(gridBefore.length)
    // And every one of them carries the parent's cell count, which is the
    // whole point of rendering them into the same tbody.
    expect(new Set(gridAfter).size).toBe(1)
    // The team audience closes the group with an Add sub-request line, and a
    // full-width row has to span exactly the parent's columns to line up.
    expect(after.spans.length).toBeGreaterThan(0)
    expect(after.spans.every(n => n === gridAfter[0])).toBe(true)
  })

  test('the mobile card list replaces the table below md', async ({ page }) => {
    await gotoRequests(page)
    test.skip(!(await isNarrow(page)), 'Chromium runs at desktop width; this is the phone case.')
    test.skip(!(await railIsOn(page)), 'The card list ships with the rail UI, behind the same gate.')
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

    // Only the layout for the current width is mounted, but the loading frame
    // before the width is measured has both, so filter to what is on screen
    // rather than guessing which one it is.
    const noMatch = page.getByText('No requests match').filter({ visible: true })
    const clear = page.getByRole('button', { name: 'Clear filters' }).filter({ visible: true })

    await search.fill('zzzzz-no-request-has-this-title')
    await expect(noMatch).toBeVisible({ timeout: 10_000 })

    await expect(clear).toBeVisible()
    await clear.click()
    await expect(noMatch).toHaveCount(0, { timeout: 10_000 })
  })

  // ── Blockers ───────────────────────────────────────────────────────────────

  test.describe('blockers', () => {
    // Serial, because both cases write a blocker onto the same seeded request
    // and the suite otherwise runs them in two browsers at once: the glyph
    // then reads "Blocked by 2 items" and the narrowing case sees a row the
    // other one is about to unblock. Index 1 keeps them off the request
    // e2e/requests-detail.spec.ts blocks in its own worker at the same time.
    test.describe.configure({ mode: 'serial' })

    test('a blocked request wears the pause glyph', async ({ page, request }) => {
      const target = pickPipelineRequest(await listRequests(request), 1)
      test.skip(!target, 'This dataset has fewer than two blockable requests.')
      if (!target) return

      // One more than the row already carries. A crashed run leaves an orphan
      // link behind, and a flat "1" then blames the feature for the harness.
      const n = (target.blockedByCount ?? 0) + 1
      const expected = `Blocked by ${n} item${n === 1 ? '' : 's'}`

      const taskId = await createTask(request, { title: `Playwright list blocker ${Date.now()}` })
      let linkId: string | null = null
      try {
        linkId = await addBlocker(request, { type: 'request', id: target.id }, { type: 'task', id: taskId })

        await gotoRequests(page)
        await listSettled(page)
        // Narrow first. Nothing below can see a row on page two.
        await narrowToRequest(page, target.title)

        const link = page.locator(`a[href="/requests/${target.id}"]`).filter({ visible: true })
        await expect(link).toHaveCount(1, { timeout: 20_000 })

        // A distinct glyph in a distinct ink, on the row it belongs to. Scope
        // creep already spends the AlertTriangle in danger red, so a blocker
        // cannot use it: one icon for "this has grown" and "this cannot move"
        // would be a lie.
        //
        // Read off the row rather than off the page, because another spec is
        // blocking another request in a parallel worker while this runs. The
        // table gives the row a role and that is what is used above md; the
        // card list is a plain <div> with none, so the DOM walk is kept as the
        // fallback for it. The walk climbs past ancestors that only repeat
        // THIS request's href (a sub-request chip pointing back at its parent
        // is a link too) and stops at the first one holding a link to another
        // request, which is the row boundary in either layout.
        const glyphLabel = async (): Promise<string | null> => {
          const tableRow = page.getByRole('row').filter({ has: link })
          if ((await tableRow.count()) === 1) {
            const glyph = tableRow.locator('[aria-label^="Blocked by "]')
            return (await glyph.count()) > 0
              ? await glyph.first().getAttribute('aria-label')
              : null
          }
          return await link.first().evaluate(el => {
            const own = el.getAttribute('href')
            let row: Element = el
            for (let node = el.parentElement; node; node = node.parentElement) {
              const others = Array.from(node.querySelectorAll('a[href^="/requests/"]'))
                .filter(a => a.getAttribute('href') !== own)
              if (others.length > 0) break
              row = node
            }
            return row.querySelector('[aria-label^="Blocked by "]')?.getAttribute('aria-label') ?? null
          })
        }

        // Polled rather than read once: a re-render between the link settling
        // and the read would otherwise make a correct glyph look missing.
        await expect
          .poll(glyphLabel, {
            message: 'the blocked row carries no pause glyph',
            timeout: 20_000,
          })
          .toBe(expected)
      } finally {
        if (linkId) await removeBlocker(request, { type: 'request', id: target.id }, linkId)
        await deleteTask(request, taskId)
      }
    })

    test('the Blocked saved view narrows, and its count is the list it produces', async ({ page, request }) => {
      const target = pickPipelineRequest(await listRequests(request), 1)
      test.skip(!target, 'This dataset has fewer than two blockable requests.')
      if (!target) return

      const taskId = await createTask(request, { title: `Playwright view blocker ${Date.now()}` })
      let linkId: string | null = null
      try {
        linkId = await addBlocker(request, { type: 'request', id: target.id }, { type: 'task', id: taskId })

        await gotoRequests(page)
        await listSettled(page)
        test.skip(!(await railIsOn(page)), 'Rail UI is super-admin gated; the bypass user is not one.')
        const rail = page.getByRole('complementary', { name: /Saved views/i })
        test.skip((await rail.count()) === 0, 'The rail is inside the Filters sheet at this width.')

        const rows = page.locator('a[href^="/requests/"]').filter({ visible: true })
        // The toolbar's number, not the rendered row count. Both the rail's
        // Blocked count and this one are computed over the whole fetched set,
        // while the table draws at most one page of 20, so comparing the rail
        // against rendered rows would only ever assert that fewer than a page
        // of requests are blocked.
        const before = await countValue(page)
        expect(before, 'the toolbar printed no count').toBeGreaterThan(0)

        const blocked = rail.getByRole('button', { name: /^Blocked/ })
        await blocked.click()
        await expect(blocked).toHaveAttribute('aria-pressed', 'true')

        // The blocked row survives, the lens is genuinely smaller, and the
        // number the rail prints is the number of rows it produced. That last
        // one is what a derived saved view gets wrong without anyone noticing.
        await expect(page.locator(`a[href="/requests/${target.id}"]`).filter({ visible: true }))
          .toHaveCount(1, { timeout: 20_000 })
        const counted = Number(((await blocked.textContent()) ?? '').replace(/\D/g, ''))
        expect(counted, 'the rail printed no Blocked count').toBeGreaterThan(0)
        expect(counted, 'every request in this dataset is blocked').toBeLessThan(before)
        // The narrowed set, counted twice by two different pieces of code:
        // the rail's own tally and the toolbar's.
        await expect
          .poll(() => countValue(page), {
            message: 'the rail count and the list disagree',
            timeout: 20_000,
          })
          .toBe(counted)
        // And what is actually drawn is that set, or its first page of it.
        await expect(rows).toHaveCount(Math.min(counted, PAGE_SIZE))
      } finally {
        if (linkId) await removeBlocker(request, { type: 'request', id: target.id }, linkId)
        await deleteTask(request, taskId)
      }
    })
  })
})
