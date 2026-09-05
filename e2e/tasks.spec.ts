import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { primePage, shipStudioStorageState, expectNoHorizontalScroll, isNarrow } from './helpers'

/**
 * Tasks: the happy path.
 *
 * Auth is the dev-only Ship Studio bypass, which resolves to the Tahi admin
 * org, so everything here runs as an admin on both the chromium and the
 * mobile-safari (iPhone 13) projects.
 *
 * These assert on chrome, never on a particular seeded task surviving. The
 * two cases that need a row create their own through the API and delete it
 * again, so a fresh database does not turn into a red suite and a run does
 * not leave anything behind.
 *
 * There is no super-admin gate on this surface, so unlike the Requests specs
 * there is no test.skip scaffolding here. Do not add any. The only skips are
 * the two width-gated halves: the rail is on screen above lg, the Filters
 * sheet stands in for it below.
 */

test.use({ storageState: shipStudioStorageState })

interface TaskSummary {
  id: string
  title: string
}

/** Create a Tahi-internal task, so the write needs no client. */
async function createTask(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.post('/api/admin/tasks', {
    data: { title, type: 'tahi_internal', priority: 'standard', status: 'todo' },
  })
  expect(res.status(), 'the task fixture could not be created').toBe(201)
  const { id } = await res.json() as { id: string }
  return id
}

async function deleteTask(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`/api/admin/tasks/${id}`)
}

/** The id of a task created through the UI, so the spec can clean up after
 *  itself. Null when the title never landed. */
async function findTaskByTitle(request: APIRequestContext, title: string): Promise<string | null> {
  const res = await request.get('/api/admin/tasks')
  if (!res.ok()) return null
  const { tasks } = await res.json() as { tasks: TaskSummary[] }
  return tasks.find(t => t.title === title)?.id ?? null
}

function viewTabs(page: Page) {
  return page.getByRole('tablist', { name: 'Tasks view' })
}

/** The region the view switcher swaps. Scoping to it keeps a board or week
 *  assertion off the rail, which carries a saved view called Overdue of its
 *  own and is hidden below lg. */
function viewPanel(page: Page) {
  return page.locator('#tasks-view-panel')
}

/** Only one of the two row layouts is on screen at a time: the table above
 *  md, the card list below it. Both are in the DOM. */
function rowTitles(page: Page) {
  return page.locator('[data-task-row-title]').filter({ visible: true })
}

async function gotoTasks(page: Page): Promise<void> {
  // A dev server compiling a sibling route can reset the first connection,
  // which Chromium reports as an aborted navigation. One retry keeps the
  // spec honest about the page rather than the harness.
  try {
    await page.goto('/tasks')
  } catch (err) {
    if (!String(err).includes('ERR_ABORTED')) throw err
    await page.goto('/tasks')
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tasks', { timeout: 20_000 })
}

/**
 * Wait for the list to settle into rows or an empty state. The shell keeps an
 * SSE notification stream open, so networkidle never fires, and the table
 * frame is in the DOM before the fetch resolves.
 *
 * Every view waits on this, not just the list: the shell holds a skeleton
 * over the board and the week planner until both the tasks fetch and
 * /api/admin/profile have answered, and against a cold dev server that took
 * fourteen seconds. Switching views before it lands measures the skeleton.
 */
async function listSettled(page: Page): Promise<void> {
  await page
    .locator('[data-task-row-title]')
    .or(page.getByText('Nothing on the list'))
    .or(page.getByText('No tasks match'))
    .first()
    .waitFor({ state: 'attached', timeout: 45_000 })
    .catch(() => {})
}

test.describe('Tasks', () => {
  // Each case pays for a navigation plus a client-side fetch against a dev
  // server that compiles on the first hit, which is most of the 30s default
  // before an assertion runs.
  test.describe.configure({ timeout: 120_000 })

  // A fresh context looks like a first visit, so the product tour spotlight
  // would sit over the page and swallow every click and Tab press below.
  test.beforeEach(async ({ page }) => { await primePage(page) })

  test('the page loads with three peer views', async ({ page }) => {
    await gotoTasks(page)
    const tabs = viewTabs(page)
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole('tab')).toHaveCount(3)
    await expect(tabs.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute('aria-selected', 'true')
    // One pill for the whole strip, not a background per button.
    await expect(tabs.locator('.tahi-seg-pill')).toHaveCount(1)
  })

  test('switching to the board shows the four task columns', async ({ page }) => {
    await gotoTasks(page)
    await listSettled(page)
    await viewTabs(page).getByRole('tab', { name: 'Board', exact: true }).click()
    for (const status of ['todo', 'in_progress', 'blocked', 'done']) {
      await expect(
        viewPanel(page).locator(`[data-board-column][data-column-status="${status}"]`),
      ).toBeVisible({ timeout: 20_000 })
    }
  })

  test('switching to my week shows the summary strip', async ({ page }) => {
    await gotoTasks(page)
    await listSettled(page)
    await viewTabs(page).getByRole('tab', { name: 'My week', exact: true }).click()
    // Either the strip or the clear-week empty state; both are correct
    // answers depending on what is assigned to the bypass user.
    await expect(
      viewPanel(page).getByText(/Overdue|A clear week/).first(),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('quick add parses the line and creates the task', async ({ page, request }) => {
    await gotoTasks(page)
    await listSettled(page)

    const input = page.getByRole('textbox', { name: 'Add a task' })
    await expect(input).toBeVisible()
    // The box around the input, so the hint chips are read where they live
    // rather than anywhere on the page that happens to say "High".
    const quickAdd = page.locator('.tahi-focus-within').filter({ has: input })

    const title = `Playwright quick add ${Date.now()}`
    await input.fill(`${title} tomorrow !high`)

    // The hint chips read the line back before anything is written.
    await expect(quickAdd.getByText('High', { exact: true })).toBeVisible()
    await expect(quickAdd.getByText('No date', { exact: true })).toHaveCount(0)

    await input.press('Enter')
    try {
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 })
      // The date and the priority tokens are lifted out of the title.
      await expect(page.getByText(`${title} tomorrow`)).toHaveCount(0)
      // The box empties, so the next line starts clean.
      await expect(input).toHaveValue('')
    } finally {
      const created = await findTaskByTitle(request, title)
      if (created) await deleteTask(request, created)
    }
  })

  test('a row opens the detail slide-over, and Escape closes it', async ({ page, request }) => {
    const title = `Playwright detail ${Date.now()}`
    const id = await createTask(request, title)
    try {
      await gotoTasks(page)
      await listSettled(page)

      await rowTitles(page).filter({ hasText: title }).first().click()
      const panel = page.getByRole('dialog')
      await expect(panel).toBeVisible({ timeout: 15_000 })
      await expect(panel.getByText(title).first()).toBeVisible()
      // The panel is the URL, so the link is shareable.
      await expect(page).toHaveURL(new RegExp(`[?&]task=${id}`))

      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(page).not.toHaveURL(/[?&]task=/)
    } finally {
      await deleteTask(request, id)
    }
  })

  test('a saved view narrows the list and the count follows', async ({ page }) => {
    await gotoTasks(page)
    await listSettled(page)
    test.skip(await isNarrow(page), 'The rail is inside the Filters sheet at this width.')

    // RailLayout keeps the aside's aria-label from the Requests rail
    // ("Saved views, filters and sort"), so this locator is shared with the
    // Requests specs on purpose. If the generalisation in Slice 1 renamed it,
    // fix the label, not this test.
    const rail = page.getByRole('complementary', { name: /Saved views/i })
    const blocked = rail.getByRole('button', { name: /^Blocked/ })
    // Each saved view prints its own count, so the toolbar has a number to
    // agree with rather than a magic one.
    const expected = Number(((await blocked.textContent()) ?? '').replace(/\D/g, ''))
    expect(Number.isNaN(expected)).toBe(false)

    await blocked.click()
    await expect(blocked).toHaveAttribute('aria-pressed', 'true')
    // The count line is the one aria-live region on the toolbar row.
    await expect(
      page.getByText(new RegExp(`^${expected} tasks?$`)).first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(rowTitles(page)).toHaveCount(expected)
  })

  test('the filters sheet opens on a phone', async ({ page }) => {
    await gotoTasks(page)
    test.skip(!(await isNarrow(page)), 'Desktop shows the rail directly.')

    await page.getByRole('button', { name: /^Filters/ }).click()
    const sheet = page.getByRole('dialog', { name: /Filters and sort/i })
    await expect(sheet).toBeVisible()
    await page.getByRole('button', { name: /^Show \d+$/ }).click()
    await expect(sheet).toBeHidden()
  })

  test('nothing scrolls sideways at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoTasks(page)
    await listSettled(page)
    await expectNoHorizontalScroll(page)

    await viewTabs(page).getByRole('tab', { name: 'Board', exact: true }).click()
    await expect(viewPanel(page).locator('[data-board-column]').first()).toBeVisible({ timeout: 20_000 })
    // The board scrolls INSIDE its own scroller; the page must not.
    await expectNoHorizontalScroll(page)

    await viewTabs(page).getByRole('tab', { name: 'My week', exact: true }).click()
    await expect(
      viewPanel(page).getByText(/Overdue|A clear week/).first(),
    ).toBeVisible({ timeout: 20_000 })
    await expectNoHorizontalScroll(page)
  })
})
