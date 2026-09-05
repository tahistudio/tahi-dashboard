import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  primePage,
  shipStudioStorageState,
  expectNoHorizontalScroll,
  isNarrow,
  railIsOnScreen,
  filterChip,
  html5DragTo,
} from './helpers'

/**
 * Tasks: the happy path, plus the writes the lead could not exercise live.
 *
 * Auth is the dev-only Ship Studio bypass, which resolves to the Tahi admin
 * org, so everything here runs as an admin on both the chromium and the
 * mobile-safari (iPhone 13) projects.
 *
 * These assert on chrome, never on a particular seeded task surviving. Every
 * case that needs a row creates its own through the API and deletes it again,
 * so a fresh database does not turn into a red suite and a run does not leave
 * anything behind. A case that needs its fixture to be ON SCREEN narrows the
 * lens with the search box first: DataTable paginates at 20 rows and the
 * default sort puts an undated task last, so on a real dataset an unsearched
 * fixture sits on page two.
 *
 * Two behaviours are deliberately not covered here, so their absence is a
 * decision rather than a gap:
 *
 * - **The client-org redirect** (`/tasks` sends a non-Tahi org to
 *   `/overview`). The Ship Studio bypass pins the admin org for the whole
 *   browser context, so this suite has no way to be anyone else. It needs a
 *   real client session, which is the portal specs' scaffolding.
 * - **Dark mode.** Nothing in the repo drives the theme class from a spec;
 *   it stays a live check on the Definition of Done list.
 *
 * There is no super-admin gate on this surface, so unlike the Requests specs
 * there is no test.skip scaffolding here. Do not add any. The only skips are
 * width-gated: the rail is on screen above lg (railIsOnScreen), the Filters
 * sheet stands in for it below, and dragging and row checkboxes are pointer
 * and table affordances that a phone does not offer.
 */

test.use({ storageState: shipStudioStorageState })

/** DataTable turns pagination on above this many rows and shows one page. */
const PAGE_SIZE = 20

interface TaskSummary {
  id: string
  title: string
}

/** The fields this spec reads back off the server. */
interface TaskRecord {
  id: string
  type: string
  orgId: string | null
  title: string
  status: string
  priority: string
  dueDate: string | null
  assigneeId: string | null
}

interface NewTask {
  title: string
  type?: string
  orgId?: string | null
  status?: string
  priority?: string
  dueDate?: string | null
  assigneeId?: string | null
  assigneeType?: string | null
}

/** Create a task. Tahi-internal and undated unless the case says otherwise,
 *  so the write needs no client. */
async function createTask(request: APIRequestContext, task: NewTask): Promise<string> {
  const res = await request.post('/api/admin/tasks', {
    data: { type: 'tahi_internal', priority: 'standard', status: 'todo', ...task },
  })
  expect(res.status(), 'the task fixture could not be created').toBe(201)
  const { id } = await res.json() as { id: string }
  return id
}

/** Soft, because every call site is inside a `finally` and the failure that
 *  sent it there is the one worth reporting. It is still said out loud: a
 *  leaked fixture is exactly what pushes the lens past its first page. */
async function deleteTask(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.delete(`/api/admin/tasks/${id}`)
  expect.soft(res.ok(), `the task fixture ${id} was not cleaned up`).toBeTruthy()
}

async function getTask(request: APIRequestContext, id: string): Promise<TaskRecord> {
  const res = await request.get(`/api/admin/tasks/${id}`)
  expect(res.ok(), `the task ${id} could not be read back`).toBeTruthy()
  const { task } = await res.json() as { task: TaskRecord }
  return task
}

/** The id of a task created through the UI, so the spec can clean up after
 *  itself and assert on what was actually written. Polls, because the row
 *  lands through a fetch the spec cannot await. Null when it never landed. */
async function waitForTaskByTitle(
  request: APIRequestContext,
  title: string,
  timeout = 20_000,
): Promise<string | null> {
  const deadline = Date.now() + timeout
  for (;;) {
    const res = await request.get('/api/admin/tasks')
    if (res.ok()) {
      const { tasks } = await res.json() as { tasks: TaskSummary[] }
      const match = tasks.find(t => t.title === title)
      if (match) return match.id
    }
    if (Date.now() > deadline) return null
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

/** Local YYYY-MM-DD, `offset` days from today. The page builds its own keys
 *  the same way (lib/tasks-views `taskDayKey`), in the same timezone. */
function dayKey(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
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

function railAside(page: Page) {
  // RailLayout keeps the aside's aria-label from the Requests rail
  // ("Saved views, filters and sort"), so this locator is shared with the
  // Requests specs on purpose. If the generalisation in Slice 1 renamed it,
  // fix the label, not this test.
  return page.getByRole('complementary', { name: /Saved views/i })
}

/** The toolbar's count line, the one aria-live number beside the search. */
function countLine(page: Page) {
  return page.getByText(/^\d+ tasks?$/).first()
}

async function countValue(page: Page): Promise<number> {
  return Number(((await countLine(page).textContent()) ?? '').replace(/\D/g, ''))
}

/** The number a rail row prints beside its label. */
async function railCount(page: Page, label: RegExp): Promise<number> {
  const text = (await railAside(page).getByRole('button', { name: label }).textContent()) ?? ''
  return Number(text.replace(/\D/g, ''))
}

/** Narrow the lens to one fixture, whatever else is in the database. */
async function searchFor(page: Page, term: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Search tasks or clients' }).fill(term)
}

async function gotoPath(page: Page, path: string): Promise<void> {
  // A dev server compiling a sibling route can reset the first connection,
  // which Chromium reports as an aborted navigation. One retry keeps the
  // spec honest about the page rather than the harness.
  try {
    await page.goto(path)
  } catch (err) {
    if (!String(err).includes('ERR_ABORTED')) throw err
    await page.goto(path)
  }
}

async function gotoTasks(page: Page): Promise<void> {
  await gotoPath(page, '/tasks')
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

  test('quick add parses the line and writes what it parsed', async ({ page, request }) => {
    await gotoTasks(page)
    await listSettled(page)

    const input = page.getByRole('textbox', { name: 'Add a task' })
    await expect(input).toBeVisible()
    // The box around the input, so the hint chips are read where they live
    // rather than anywhere on the page that happens to say "High".
    const quickAdd = page.locator('.tahi-focus-within').filter({ has: input })

    const title = `Playwright quick add ${Date.now()}`
    const created: string[] = []
    try {
      await input.fill(`${title} tomorrow !high`)

      // The hint chips read the line back before anything is written.
      await expect(quickAdd.getByText('High', { exact: true })).toBeVisible()
      await expect(quickAdd.getByText('No date', { exact: true })).toHaveCount(0)

      await input.press('Enter')
      // The box empties, so the next line starts clean.
      await expect(input).toHaveValue('')

      // The row, not the parser. Everything above reads values parseQuickAdd
      // computed in the browser; if the shell stopped sending the priority or
      // the date, or coerced the level, all of it would still pass. Exact
      // equality on the title is also what proves the tokens were lifted out
      // rather than left in it, which a substring match cannot say.
      const id = await waitForTaskByTitle(request, title)
      expect(id, 'quick add did not persist the parsed title').not.toBeNull()
      if (!id) return
      created.push(id)

      const row = await getTask(request, id)
      expect(row.priority, '!high did not reach the row').toBe('high')
      expect(row.dueDate, 'tomorrow did not reach the row').toBe(dayKey(1))

      await expect(rowTitles(page).filter({ hasText: title })).toHaveCount(1)
    } finally {
      for (const id of created) await deleteTask(request, id)
    }
  })

  test('quick add reads an @client mention as internal client work', async ({ page, request }) => {
    // A name ending in a non-word character cannot satisfy the parser's
    // trailing \b, and a duplicated name resolves to whichever row the API
    // listed first, so the fixture picks a client that is neither.
    const res = await request.get('/api/admin/clients?status=active')
    expect(res.ok(), 'the client list could not be read').toBeTruthy()
    const { organisations } = await res.json() as { organisations: { id: string; name: string }[] }
    const names = organisations.map(o => o.name)
    const client = organisations.find(o =>
      /\w$/.test(o.name) && names.filter(n => n === o.name).length === 1)
    test.skip(!client, 'No client in this dataset can be named in a mention.')
    if (!client) return

    await gotoTasks(page)
    await listSettled(page)

    const input = page.getByRole('textbox', { name: 'Add a task' })
    const title = `Playwright mention ${Date.now()}`
    const created: string[] = []
    try {
      await input.fill(`${title} @${client.name}`)
      await input.press('Enter')
      await expect(input).toHaveValue('')

      const id = await waitForTaskByTitle(request, title)
      expect(id, 'the mention line did not persist').not.toBeNull()
      if (!id) return
      created.push(id)

      const row = await getTask(request, id)
      expect(row.orgId, 'the mention did not link the client').toBe(client.id)
      // Decision 13: a mention yields Internal, not Client.
      expect(row.type, 'a mention should file the task as internal client work')
        .toBe('internal_client_task')
    } finally {
      for (const id of created) await deleteTask(request, id)
    }
  })

  test('a row opens the detail slide-over, and Escape closes it', async ({ page, request }) => {
    const title = `Playwright detail ${Date.now()}`
    const id = await createTask(request, { title, dueDate: dayKey(0) })
    try {
      await gotoTasks(page)
      await listSettled(page)
      // The lens holds every task in the database, so the fixture is only on
      // the first page once the search has cut the rest away.
      await searchFor(page, title)
      await expect(rowTitles(page)).toHaveCount(1)

      await rowTitles(page).first().click()
      const panel = page.getByRole('dialog')
      await expect(panel).toBeVisible({ timeout: 15_000 })
      await expect(panel.getByRole('textbox', { name: 'Task title' })).toHaveValue(title)
      // The panel is the URL, so the link is shareable.
      await expect(page).toHaveURL(new RegExp(`[?&]task=${id}`))

      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(page).not.toHaveURL(/[?&]task=/)
    } finally {
      await deleteTask(request, id)
    }
  })

  test('a deep link opens the panel, and /tasks/<id> still lands on it', async ({ page, request }) => {
    // Both halves of the address every notification link takes
    // (lib/notification-links.ts routes a task at /tasks/<id>, which the page
    // redirects to /tasks?task=<id>, which the shell reads into its initial
    // state). Neither is reachable by clicking a row, so neither is covered
    // by the case above.
    const title = `Playwright deep link ${Date.now()}`
    const id = await createTask(request, { title })
    try {
      await gotoPath(page, `/tasks?task=${id}`)
      const panel = page.getByRole('dialog')
      await expect(panel).toBeVisible({ timeout: 30_000 })
      await expect(panel.getByRole('textbox', { name: 'Task title' })).toHaveValue(title)

      await gotoPath(page, `/tasks/${id}`)
      await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${id}`), { timeout: 30_000 })
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByRole('dialog').getByRole('textbox', { name: 'Task title' }),
      ).toHaveValue(title)
    } finally {
      await deleteTask(request, id)
    }
  })

  test('setting the level to Tahi clears the client, in the panel and on the server', async ({ page, request }) => {
    // Decision 16's invariant, the subtlest logic in the port: a Tahi task
    // cannot hold a client, so choosing that level drops the link.
    const res = await request.get('/api/admin/clients?status=active')
    expect(res.ok(), 'the client list could not be read').toBeTruthy()
    const { organisations } = await res.json() as { organisations: { id: string; name: string }[] }
    const client = organisations[0]
    test.skip(!client, 'No active client in this dataset to link.')
    if (!client) return

    const title = `Playwright level ${Date.now()}`
    const id = await createTask(request, {
      title,
      type: 'internal_client_task',
      orgId: client.id,
    })
    try {
      await gotoPath(page, `/tasks?task=${id}`)
      const panel = page.getByRole('dialog')
      await expect(panel).toBeVisible({ timeout: 30_000 })

      const clientField = panel.getByRole('button', { name: 'Link a client' })
      await expect(clientField).toContainText(client.name)

      await panel.getByRole('radiogroup', { name: 'Level' })
        .getByRole('radio', { name: 'Tahi', exact: true })
        .click()

      await expect(clientField).toContainText('No client')
      await expect.poll(
        async () => (await getTask(request, id)).orgId,
        { message: 'the client is still linked on the server', timeout: 20_000 },
      ).toBeNull()
      expect((await getTask(request, id)).type).toBe('tahi_internal')
    } finally {
      await deleteTask(request, id)
    }
  })

  test('a saved view narrows the list and the count follows', async ({ page, request }) => {
    // Its own fixtures, so the expected count is provably more than zero and
    // the narrowing is provable too: one row that belongs in the view, one
    // that does not.
    const stamp = Date.now()
    const blockedTitle = `Playwright blocked ${stamp}`
    const openTitle = `Playwright open ${stamp}`
    const blockedId = await createTask(request, { title: blockedTitle, status: 'blocked' })
    const openId = await createTask(request, { title: openTitle, status: 'todo' })
    try {
      await gotoTasks(page)
      await listSettled(page)
      test.skip(!(await railIsOnScreen(page)), 'The rail is inside the Filters sheet at this width.')

      const expected = await railCount(page, /^Blocked/)
      // The old guard here was `expect(Number.isNaN(expected)).toBe(false)`,
      // which can never fail: Number('') is 0, not NaN. With a blocked
      // fixture in the database this one can.
      expect(expected, 'the rail printed no Blocked count').toBeGreaterThan(0)
      const before = await countValue(page)
      expect(expected, 'every task in the dataset is blocked').toBeLessThan(before)

      await railAside(page).getByRole('button', { name: /^Blocked/ }).click()
      await expect(railAside(page).getByRole('button', { name: /^Blocked/ }))
        .toHaveAttribute('aria-pressed', 'true')

      // The count line is the one aria-live region on the toolbar row, and it
      // has to agree with the number the rail printed.
      await expect(
        page.getByText(new RegExp(`^${expected} tasks?$`)).first(),
      ).toBeVisible({ timeout: 15_000 })
      // The rail counts every row in the lens; the table renders one page.
      await expect(rowTitles(page)).toHaveCount(Math.min(expected, PAGE_SIZE))
      // The list is actually narrower, not just differently counted.
      await expect(rowTitles(page).filter({ hasText: openTitle })).toHaveCount(0)
      if (expected <= PAGE_SIZE) {
        await expect(rowTitles(page).filter({ hasText: blockedTitle })).toHaveCount(1)
      }
    } finally {
      await deleteTask(request, blockedId)
      await deleteTask(request, openId)
    }
  })

  test('a filter chip appears, moves the count, and clears', async ({ page, request }) => {
    // One open fixture guarantees the blocked lens is smaller than the whole
    // one, whatever else is in the database.
    const openId = await createTask(request, { title: `Playwright filter ${Date.now()}` })
    try {
      await gotoTasks(page)
      await listSettled(page)
      test.skip(!(await railIsOnScreen(page)), 'The rail is inside the Filters sheet at this width.')

      const before = await countValue(page)
      expect(before, 'the toolbar printed no count').toBeGreaterThan(0)

      await railAside(page).getByRole('button', { name: /^Status:/ }).click()
      await page.getByRole('listbox', { name: 'Status' })
        .getByRole('option', { name: 'Blocked', exact: true })
        .click()

      const chip = filterChip(page, 'status')
      await expect(chip).toBeVisible()
      await expect(chip).toContainText('Blocked')
      await expect.poll(() => countValue(page), {
        message: 'the count ignored the status filter',
        timeout: 15_000,
      }).toBeLessThan(before)

      await chip.getByRole('button', { name: 'Clear the status filter' }).click()
      await expect(chip).toHaveCount(0)
      await expect.poll(() => countValue(page), {
        message: 'clearing the chip did not put the list back',
        timeout: 15_000,
      }).toBe(before)
    } finally {
      await deleteTask(request, openId)
    }
  })

  test('bulk complete marks every selected row done', async ({ page, request }) => {
    const stamp = Date.now()
    const ids = [
      await createTask(request, { title: `Playwright bulk one ${stamp}` }),
      await createTask(request, { title: `Playwright bulk two ${stamp}` }),
    ]
    try {
      await gotoTasks(page)
      await listSettled(page)
      test.skip(await isNarrow(page), 'Row checkboxes are a table affordance.')

      // The stamp is in both titles and nothing else, so the search leaves
      // exactly the two fixtures and select-all can only reach them.
      await searchFor(page, String(stamp))
      await expect(rowTitles(page)).toHaveCount(2)

      await page.getByRole('checkbox', { name: 'Select all rows' }).click()
      await page.getByRole('button', { name: 'Complete', exact: true }).click()

      await expect(page.getByRole('status').filter({ hasText: '2 tasks marked done' }))
        .toBeVisible({ timeout: 20_000 })
      for (const id of ids) {
        await expect.poll(
          async () => (await getTask(request, id)).status,
          { message: 'a selected row was not completed', timeout: 20_000 },
        ).toBe('done')
      }
    } finally {
      for (const id of ids) await deleteTask(request, id)
    }
  })

  test('a board drop writes the new status', async ({ page, request }) => {
    const title = `Playwright board ${Date.now()}`
    const id = await createTask(request, { title, status: 'todo' })
    try {
      await gotoTasks(page)
      await listSettled(page)
      test.skip(await isNarrow(page), 'Dragging is a pointer affordance; a phone moves work from the panel.')

      // The board draws the same rows the list does, so the search leaves one
      // card and the columns cannot be confused for each other.
      await searchFor(page, title)
      await viewTabs(page).getByRole('tab', { name: 'Board', exact: true }).click()

      const card = viewPanel(page)
        .locator('[data-board-column][data-column-status="todo"]')
        .getByRole('button', { name: `Open ${title}` })
      await expect(card).toBeVisible({ timeout: 20_000 })

      await html5DragTo(
        page,
        card,
        viewPanel(page).locator('[data-board-column][data-column-status="in_progress"]'),
      )

      await expect.poll(
        async () => (await getTask(request, id)).status,
        { message: 'the drop did not write the column status', timeout: 20_000 },
      ).toBe('in_progress')

      // And it stuck: the board view is a stored preference, so the reload
      // comes back on the board with the card in its new column.
      await page.reload()
      await listSettled(page)
      await expect(
        viewPanel(page)
          .locator('[data-board-column][data-column-status="in_progress"]')
          .getByRole('button', { name: `Open ${title}` }),
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await deleteTask(request, id)
    }
  })

  test('a my week drop rewrites the due date', async ({ page, request }) => {
    // The planner draws the viewer's own open plate, so the fixture has to be
    // assigned to whoever the bypass resolves to.
    const res = await request.get('/api/admin/profile')
    expect(res.ok(), 'the profile could not be read').toBeTruthy()
    const { member } = await res.json() as { member: { id: string } | null }
    test.skip(!member, 'The bypass user has no team member row to plan for.')
    if (!member) return

    const title = `Playwright week ${Date.now()}`
    const id = await createTask(request, {
      title,
      assigneeId: member.id,
      assigneeType: 'team_member',
    })
    try {
      await gotoTasks(page)
      await listSettled(page)
      test.skip(await isNarrow(page), 'Dragging is a pointer affordance; a phone moves work from the panel.')

      await viewTabs(page).getByRole('tab', { name: 'My week', exact: true }).click()
      // Undated, so it starts in the No date column and Today is a real move.
      const row = viewPanel(page).getByRole('button', { name: `Open ${title}` })
      await expect(row).toBeVisible({ timeout: 20_000 })

      await html5DragTo(page, row, viewPanel(page).getByRole('region', { name: 'Today', exact: true }))

      await expect.poll(
        async () => (await getTask(request, id)).dueDate,
        { message: 'the drop did not write the due date', timeout: 20_000 },
      ).toBe(dayKey(0))
    } finally {
      await deleteTask(request, id)
    }
  })

  test('save as default survives a reload, and reset comes back', async ({ page }) => {
    await gotoTasks(page)
    await listSettled(page)
    test.skip(!(await railIsOnScreen(page)), 'The rail is inside the Filters sheet at this width.')

    const rail = railAside(page)

    await rail.getByRole('button', { name: /^Blocked/ }).click()
    await rail.getByRole('button', { name: /^Priority:/ }).click()
    await page.getByRole('listbox', { name: 'Priority' })
      .getByRole('option', { name: 'High', exact: true })
      .click()
    await rail.getByRole('button', { name: /^Sort order:/ }).click()

    await page.getByRole('button', { name: 'Save as default' }).click()
    await expect(page.getByRole('button', { name: 'Your default' })).toBeVisible()

    await page.reload()
    await listSettled(page)

    // Every dimension of the snapshot, and the snapshot itself: "Your
    // default" only reads that way while the saved default and the live rail
    // still match, so it is the one assertion the per-key persistence cannot
    // satisfy on its own.
    await expect(rail.getByRole('button', { name: /^Blocked/ }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect(rail.getByRole('button', { name: 'Priority: High' })).toBeVisible()
    await expect(filterChip(page, 'priority')).toBeVisible()
    await expect(rail.getByRole('button', { name: /^Sort order: Latest first/ })).toBeVisible()
    await expect(viewTabs(page).getByRole('tab', { name: 'List', exact: true }))
      .toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Your default' })).toBeVisible()

    // Wandering off it offers the way back.
    await rail.getByRole('button', { name: /^All tasks/ }).click()
    const reset = page.getByRole('button', { name: 'Reset to default' })
    await expect(reset).toBeVisible()
    await reset.click()
    await expect(rail.getByRole('button', { name: /^Blocked/ }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  test('the filters sheet opens on a phone', async ({ page }) => {
    await gotoTasks(page)
    test.skip(await railIsOnScreen(page), 'Desktop shows the rail directly.')

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
