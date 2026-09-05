import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import {
  primePage,
  shipStudioStorageState,
  expectNoHorizontalScroll,
  isNarrow,
  railIsOnScreen,
  filterChip,
  html5DragTo,
  createTask,
  deleteTask,
  getTask,
  addBlocker,
  listBlockers,
  listRequests,
  pickPipelineRequest,
  requestRef,
  railCardHead,
  railCardBody,
  expectCardCount,
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
 * - **A real AI turn.** The wizard cases stop at the last thing that happens
 *   before the model is reached. A conversation costs money on every run of
 *   every branch, and what it would prove (that Claude answers) is not this
 *   suite's to assert. The honest 503 is out of reach for the same reason:
 *   the route only sends it when the key is missing AND NODE_ENV is
 *   production, and a dev server with no key answers 200 with a keyword draft
 *   flagged `degraded`, deliberately. Telling those apart costs a turn.
 *
 * There is no super-admin gate on this surface, so unlike the Requests specs
 * there is no test.skip scaffolding here. Do not add any. The only skips are
 * width-gated: the rail is on screen above lg (railIsOnScreen), the Filters
 * sheet stands in for it below, and dragging and row checkboxes are pointer
 * and table affordances that a phone does not offer. The blocker cases, the
 * strip's keyboard path and both AI cases run at every width, because a
 * picker, a roving tabindex and a paperclip are all things a phone has.
 */

test.use({ storageState: shipStudioStorageState })

/** DataTable turns pagination on above this many rows and shows one page. */
const PAGE_SIZE = 20

interface TaskSummary {
  id: string
  title: string
}

// createTask, deleteTask and getTask live in e2e/helpers.ts: the blocker cases
// in the two Requests specs build the same fixtures, and one definition cannot
// drift from itself.

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

/** The team member the Ship Studio bypass resolves to. The planner draws that
 *  person's own plate, so every My week fixture has to be assigned to them. */
async function bypassMemberId(request: APIRequestContext): Promise<string | null> {
  const res = await request.get('/api/admin/profile')
  expect(res.ok(), 'the profile could not be read').toBeTruthy()
  const { member } = await res.json() as { member: { id: string } | null }
  return member?.id ?? null
}

/**
 * Add a blocker through the picker.
 *
 * Typing is the only way to fill it: the options are server-searched
 * (Decision 17) and empty until a query has been answered, which is exactly
 * what lets it reach a task outside the current lens. The fetch behind it is
 * debounced, so the wait is on the row appearing rather than on a timer, and
 * the menu is portalled, so it is looked for on the page rather than inside
 * the card.
 */
async function pickBlocker(page: Page, scope: Locator, query: string, name: string): Promise<void> {
  await scope.getByRole('button', { name: 'Add a blocker' }).click()
  await page.getByRole('textbox', { name: 'Search tasks and requests' }).fill(query)
  await page
    .getByRole('menu', { name: 'Add a blocker' })
    .getByRole('menuitem')
    .filter({ hasText: name })
    .first()
    .click({ timeout: 20_000 })
}

/** The request status labels these cases can meet, restated rather than
 *  imported: a spec that read REQUEST_STATUS_LABELS would agree with the page
 *  even on the day both were wrong. */
const REQUEST_STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  in_review: 'In Review',
  in_progress: 'In Progress',
  client_review: 'Client Review',
}

// ── The week strip ───────────────────────────────────────────────────────────
//
// lib/tasks-planner.ts builds every cell from the wall clock, so the spec has
// to build the same day from the same clock rather than asserting a date it
// hardcoded. These four mirror `weekStart`, `buildWeekStrip` and
// `stripRangeLabel`; the module's own Vitest file freezes their arithmetic,
// and this restates the answer a human reads off the screen.

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** Monday of the week containing today, shifted by whole weeks. Sunday belongs
 *  to the week that started six days earlier, which is how the studio's week
 *  ends and how buildWeekStrip counts. */
function weekStart(weekOffset: number): Date {
  const now = new Date()
  const back = now.getDay() === 0 ? 6 : now.getDay() - 1
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + weekOffset * 7)
}

interface StripCell {
  /** The YYYY-MM-DD the drop writes. */
  key: string
  /** The one word the toast says: "Planned for Thursday". */
  name: string
  /** The aria-label's first half: "Thursday 11 Sep". */
  label: string
  dayOfMonth: number
  month: string
}

function stripDay(index: number, weekOffset = 0): StripCell {
  const start = weekStart(weekOffset)
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
  const month = MONTHS[d.getMonth()]
  return {
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    name: DAY_NAMES[d.getDay()],
    label: `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${month}`,
    dayOfMonth: d.getDate(),
    month,
  }
}

/** '31 Aug to 6 Sep', the label between the two chevrons. */
function stripRange(weekOffset = 0): string {
  const first = stripDay(0, weekOffset)
  const last = stripDay(6, weekOffset)
  return first.month === last.month
    ? `${first.dayOfMonth} to ${last.dayOfMonth} ${last.month}`
    : `${first.dayOfMonth} ${first.month} to ${last.dayOfMonth} ${last.month}`
}

/** Monday is 0 and Sunday is 6, so today's cell is at this index. */
function todayStripIndex(): number {
  const dow = new Date().getDay()
  return dow === 0 ? 6 : dow - 1
}

function stripCells(page: Page): Locator {
  return viewPanel(page).getByRole('group', { name: 'Week', exact: true }).getByRole('button')
}

/** Switch to My week and wait for the strip, not for the plate: the plate is
 *  drawn from the same rows and lands first. */
async function openWeek(page: Page): Promise<void> {
  await viewTabs(page).getByRole('tab', { name: 'My week', exact: true }).click()
  await expect(
    viewPanel(page).getByRole('group', { name: 'Week', exact: true }),
  ).toBeVisible({ timeout: 30_000 })
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
      await expect(panel.getByRole('textbox', { name: 'Task title' })).toHaveValue(title, { timeout: 30_000 })
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
      await expect(panel.getByRole('textbox', { name: 'Task title' })).toHaveValue(title, { timeout: 30_000 })

      await gotoPath(page, `/tasks/${id}`)
      await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${id}`), { timeout: 30_000 })
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByRole('dialog').getByRole('textbox', { name: 'Task title' }),
      ).toHaveValue(title, { timeout: 30_000 })
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

  // ── Blockers ───────────────────────────────────────────────────────────────

  test('the waiting on card carries a request, the picker adds a task, removing one drops the count, and Open lands on the request', async ({ page, request }) => {
    // The last step opens /requests/[id], which on a dev server that has not
    // served it yet costs a compile on top of everything above.
    test.slow()

    // Index 0 said out loud rather than left to the default, and it is the
    // same row e2e/requests-detail.spec.ts takes. That is safe only because
    // the two write opposite ends of the edge: this case makes the request a
    // BLOCKER of a task, which leaves the request's own blockedByCount alone,
    // and that count is what the other file asserts. Any case added here that
    // blocks a request needs an index nobody else touches.
    const target = pickPipelineRequest(await listRequests(request), 0)
    test.skip(!target, 'No open, numbered, uniquely titled request in this dataset to wait on.')
    if (!target) return

    const stamp = Date.now()
    const subjectId = await createTask(request, { title: `Playwright waiting ${stamp}` })
    const secondTitle = `Playwright holdup ${stamp}`
    const secondId = await createTask(request, { title: secondTitle })
    try {
      await addBlocker(request, { type: 'task', id: subjectId }, { type: 'request', id: target.id })

      await gotoPath(page, `/tasks?task=${subjectId}`)
      const panel = page.getByRole('dialog')
      await expect(panel).toBeVisible({ timeout: 30_000 })

      const head = railCardHead(panel, 'Waiting on')
      await expect(head).toBeVisible({ timeout: 30_000 })
      await expectCardCount(head, 'Waiting on', 1)

      // The four things a row has to say about a request blocker, and the
      // first is the one the port got wrong twice: a request wears the
      // request status vocabulary, not a grey pill printing `client_review`.
      const body = railCardBody(panel, 'Waiting on')
      await expect(body).toContainText(REQUEST_STATUS_LABEL[target.status])
      await expect(body).toContainText(requestRef(target.requestNumber) ?? '#')
      await expect(body).toContainText(target.title)
      await expect(body.getByRole('button', { name: 'Open', exact: true })).toHaveCount(1)

      // A second blocker, this time a task, through the picker. The fixture is
      // undated and brand new, so on a real dataset it is nowhere near the
      // first page of any lens: only a server search can find it.
      await pickBlocker(page, panel, secondTitle, secondTitle)

      await expectCardCount(head, 'Waiting on', 2)
      await expect(body).toContainText(secondTitle)
      await expect.poll(
        async () => (await listBlockers(request, { type: 'task', id: subjectId })).blockedBy.length,
        { message: 'the picker did not write the second blocker', timeout: 20_000 },
      ).toBe(2)

      // And it comes off again. The count is what the row chip and the board
      // card read, so it has to follow the removal rather than stick.
      await body.getByRole('button', { name: `Stop waiting on ${secondTitle}` }).click()
      await expectCardCount(head, 'Waiting on', 1)
      await expect(body).not.toContainText(secondTitle)
      await expect.poll(
        async () => (await listBlockers(request, { type: 'task', id: subjectId })).blockedBy.length,
        { message: 'the removal did not reach the server', timeout: 20_000 },
      ).toBe(1)

      // Open is pressed, not merely counted. This one is the weaker of the
      // two doors: the request side is a <Link> the browser would follow on
      // its own, while this is a button calling onOpenRequest, so a router
      // push that stopped working would be invisible to an existence check.
      await body.getByRole('button', { name: 'Open', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/requests/${target.id}$`), { timeout: 45_000 })
      await expect(page.getByRole('heading', { level: 1 }))
        .toHaveText(target.title, { timeout: 45_000 })
    } finally {
      await deleteTask(request, secondId)
      await deleteTask(request, subjectId)
    }
  })

  test('a blocker loop is refused in a sentence', async ({ page, request }) => {
    const stamp = Date.now()
    const upstreamTitle = `Playwright upstream ${stamp}`
    const downstreamTitle = `Playwright downstream ${stamp}`
    const upstreamId = await createTask(request, { title: upstreamTitle })
    const downstreamId = await createTask(request, { title: downstreamTitle })
    try {
      // Downstream waits on upstream. Asking upstream to wait on downstream
      // closes the loop, and the picker offers it: the search excludes the
      // subject itself and nothing else, so the refusal has to be the route's.
      await addBlocker(request, { type: 'task', id: downstreamId }, { type: 'task', id: upstreamId })

      await gotoPath(page, `/tasks?task=${upstreamId}`)
      const panel = page.getByRole('dialog')
      await expect(panel).toBeVisible({ timeout: 30_000 })
      await expect(railCardHead(panel, 'Waiting on')).toBeVisible({ timeout: 30_000 })

      await pickBlocker(page, panel, downstreamTitle, downstreamTitle)

      // The exact sentence, not a substring of a stack trace and not a
      // generic "could not add that blocker".
      await expect(page.getByRole('status').filter({ hasText: 'That would make a loop' }))
        .toBeVisible({ timeout: 20_000 })
      expect(
        (await listBlockers(request, { type: 'task', id: upstreamId })).blockedBy,
        'the refused link was written anyway',
      ).toHaveLength(0)
    } finally {
      await deleteTask(request, downstreamId)
      await deleteTask(request, upstreamId)
    }
  })

  // ── The week strip ─────────────────────────────────────────────────────────

  test('the week strip marks today, and a drop two days out writes that date', async ({ page, request }) => {
    const member = await bypassMemberId(request)
    test.skip(!member, 'The bypass user has no team member row to plan for.')
    if (!member) return

    const start = todayStripIndex()
    // Two days from today, wherever that lands. On a Saturday or a Sunday it
    // is on next week's page, so the case turns the page rather than skipping
    // itself for two days out of seven.
    const overflows = start + 2 > 6
    const targetIndex = (start + 2) % 7
    const target = stripDay(targetIndex, overflows ? 1 : 0)

    const title = `Playwright strip ${Date.now()}`
    const id = await createTask(request, {
      title,
      assigneeId: member,
      assigneeType: 'team_member',
      estimatedHours: 2,
    })
    try {
      await gotoTasks(page)
      await listSettled(page)
      test.skip(await isNarrow(page), 'Dragging is a pointer affordance; a phone plans from the panel.')
      await openWeek(page)

      const cells = stripCells(page)
      await expect(cells).toHaveCount(7)
      // Today is named, counted and filled. The class is the fill: it is what
      // the "today is marked" reading actually resolves to.
      const today = cells.nth(start)
      await expect(today).toHaveAttribute('aria-label', new RegExp(`^${stripDay(start).label}, \\d+ tasks?$`))
      await expect(today).toHaveClass(/is-today/)

      if (overflows) {
        await viewPanel(page).getByRole('button', { name: 'Next week', exact: true }).click()
        await expect(viewPanel(page).getByText(stripRange(1), { exact: true }))
          .toBeVisible({ timeout: 20_000 })
      }

      const row = viewPanel(page).getByRole('button', { name: `Open ${title}` })
      await expect(row).toBeVisible({ timeout: 20_000 })
      await html5DragTo(page, row, stripCells(page).nth(targetIndex))

      // The toast names the day it wrote, capital and all. A RegExp without
      // the i flag, because `hasText` with a plain string is case-insensitive
      // and tasks-week.tsx picks day.name over day.label precisely because
      // "the toast this feeds is lowercased upstream": a toast reading
      // "planned for thursday" is the one failure this line exists to catch.
      await expect(page.getByRole('status').filter({ hasText: new RegExp(`Planned for ${target.name}`) }))
        .toBeVisible({ timeout: 20_000 })
      await expect.poll(
        async () => (await getTask(request, id)).dueDate,
        { message: 'the strip drop did not write the due date', timeout: 20_000 },
      ).toBe(target.key)
    } finally {
      await deleteTask(request, id)
    }
  })

  test('paging the strip forward drops onto a named day next week, and paging back returns', async ({ page, request }) => {
    const member = await bypassMemberId(request)
    test.skip(!member, 'The bypass user has no team member row to plan for.')
    if (!member) return

    // Not "next week" in the title: an accessible name is matched as a
    // substring, and a row called that collides with the paging button.
    const title = `Playwright paged ${Date.now()}`
    const id = await createTask(request, { title, assigneeId: member, assigneeType: 'team_member' })
    try {
      await gotoTasks(page)
      await listSettled(page)
      test.skip(await isNarrow(page), 'Dragging is a pointer affordance; a phone plans from the panel.')
      await openWeek(page)

      const strip = viewPanel(page)
      await expect(strip.getByText(stripRange(0), { exact: true })).toBeVisible()

      await strip.getByRole('button', { name: 'Next week', exact: true }).click()
      await expect(strip.getByText(stripRange(1), { exact: true })).toBeVisible({ timeout: 20_000 })

      // Wednesday next week, and the date written has to be that Wednesday.
      // The flat Later bucket could only ever write "the day after this week
      // ends", which is the whole reason the strip pages.
      const target = stripDay(2, 1)
      const row = viewPanel(page).getByRole('button', { name: `Open ${title}` })
      await expect(row).toBeVisible({ timeout: 20_000 })
      await html5DragTo(page, row, stripCells(page).nth(2))

      await expect.poll(
        async () => (await getTask(request, id)).dueDate,
        { message: 'the paged drop did not write next week', timeout: 20_000 },
      ).toBe(target.key)

      await strip.getByRole('button', { name: 'Previous week', exact: true }).click()
      await expect(strip.getByText(stripRange(0), { exact: true })).toBeVisible({ timeout: 20_000 })
    } finally {
      await deleteTask(request, id)
    }
  })

  test('the strip takes one tab stop and moves under the arrows, the page keys and Enter', async ({ page, request }) => {
    const member = await bypassMemberId(request)
    test.skip(!member, 'The bypass user has no team member row to plan for.')
    if (!member) return

    const title = `Playwright keys ${Date.now()}`
    const id = await createTask(request, { title, assigneeId: member, assigneeType: 'team_member' })
    try {
      await gotoTasks(page)
      await listSettled(page)
      await openWeek(page)

      const cells = stripCells(page)
      const start = todayStripIndex()

      // One tab stop for seven buttons: that is what the roving tabindex buys,
      // and today is where it starts.
      const tabbable = viewPanel(page)
        .getByRole('group', { name: 'Week', exact: true })
        .locator('button[tabindex="0"]')
      await expect(tabbable).toHaveCount(1)
      await expect(tabbable).toHaveAttribute('aria-label', new RegExp(`^${stripDay(start).label},`))

      // An explicit focus() rather than a Tab count: the roving handler lives
      // on the cell, and WebKit does not focus a button on click, so a click
      // would leave the arrows going to <body>. Home first, so the arrow step
      // is the same on a Monday and on a Sunday.
      await cells.nth(start).focus()
      await expect(cells.nth(start)).toBeFocused()
      await page.keyboard.press('Home')
      await expect(cells.nth(0)).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(cells.nth(1)).toBeFocused()
      await page.keyboard.press('End')
      await expect(cells.nth(6)).toBeFocused()

      // Paging keeps the weekday and moves the range, both ways.
      await page.keyboard.press('PageDown')
      await expect(viewPanel(page).getByText(stripRange(1), { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(stripCells(page).nth(6)).toBeFocused()
      await page.keyboard.press('PageUp')
      await expect(viewPanel(page).getByText(stripRange(0), { exact: true })).toBeVisible({ timeout: 20_000 })

      // Enter hands focus to the day card the cell points at. Sunday is never
      // a day that has gone, whatever today is, so it always takes the key.
      const sundayCard = start === 6 ? 'Today' : start === 5 ? 'Tomorrow' : 'Sunday'
      await stripCells(page).nth(6).focus()
      await page.keyboard.press('Enter')
      await expect(
        viewPanel(page).getByRole('region', { name: sundayCard, exact: true }),
      ).toBeFocused()

      // And the planner finally has a keyboard path to a due date at all:
      // Alt plus an arrow on a focused row, the drag's equivalent. All three
      // branches of nudgeDueDate, because clearing a date is the one a drag
      // cannot express at all and so has no other cover.
      const row = () => viewPanel(page).getByRole('button', { name: `Open ${title}` })
      await row().focus()
      await page.keyboard.press('Alt+ArrowRight')
      await expect.poll(
        async () => (await getTask(request, id)).dueDate,
        { message: 'Alt+ArrowRight did not move the due date', timeout: 20_000 },
      ).toBe(dayKey(1))

      // Back a day. The row has moved to another day card under the write, so
      // it is located again rather than held.
      await row().focus()
      await page.keyboard.press('Alt+ArrowLeft')
      await expect.poll(
        async () => (await getTask(request, id)).dueDate,
        { message: 'Alt+ArrowLeft did not move the due date back', timeout: 20_000 },
      ).toBe(dayKey(0))

      // And up clears it, which the toast says in its own words rather than
      // naming a day.
      await row().focus()
      await page.keyboard.press('Alt+ArrowUp')
      await expect(page.getByRole('status').filter({ hasText: 'Date cleared' }))
        .toBeVisible({ timeout: 20_000 })
      await expect.poll(
        async () => (await getTask(request, id)).dueDate,
        { message: 'Alt+ArrowUp did not clear the due date', timeout: 20_000 },
      ).toBeNull()
    } finally {
      await deleteTask(request, id)
    }
  })

  test('the rail filters narrow the list and leave my week alone', async ({ page, request }) => {
    const member = await bypassMemberId(request)
    test.skip(!member, 'The bypass user has no team member row to plan for.')
    if (!member) return

    const title = `Playwright unfiltered ${Date.now()}`
    const id = await createTask(request, { title, assigneeId: member, assigneeType: 'team_member' })
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
      await expect.poll(() => countValue(page), {
        message: 'the count ignored the status filter',
        timeout: 15_000,
      }).toBeLessThan(before)
      // The fixture is a todo, so the list has genuinely dropped it.
      await expect(rowTitles(page).filter({ hasText: title })).toHaveCount(0)
      await expect(filterChip(page, 'status')).toBeVisible()

      // My week is the viewer's own plate and nothing narrows it, which is the
      // promise the view is built on. The strip is whole and the row the list
      // just dropped is on the plate.
      await openWeek(page)
      await expect(stripCells(page)).toHaveCount(7)
      await expect(viewPanel(page).getByRole('button', { name: `Open ${title}` }))
        .toBeVisible({ timeout: 20_000 })

      // The chip strip is suppressed here rather than left printing a filter
      // that changes nothing, and the rail says so in words instead of sitting
      // inert. Both halves, because a missing chip alone could just as easily
      // mean the filter had been silently cleared.
      await expect(filterChip(page, 'status')).toHaveCount(0)
      await expect(railAside(page).getByText(/My week always shows your own open plate/))
        .toBeVisible()

      // And it was not cleared: the list comes back narrowed, chip and all.
      await viewTabs(page).getByRole('tab', { name: 'List', exact: true }).click()
      await expect(filterChip(page, 'status')).toBeVisible({ timeout: 20_000 })
      await expect(rowTitles(page).filter({ hasText: title })).toHaveCount(0)
    } finally {
      await deleteTask(request, id)
    }
  })

  // ── AI task creation ───────────────────────────────────────────────────────
  //
  // No case here sends a prompt. A real turn costs money on every run, and
  // everything worth asserting at this level happens before the model is
  // reached: the hand-over, the two refusals, and the hand-back.
  //
  // The honest 503 is deliberately not asserted. The route only returns it
  // when ANTHROPIC_API_KEY is missing AND NODE_ENV is production
  // (task-wizard/route.ts); a dev server with no key answers 200 with a
  // keyword draft flagged `degraded`, on purpose, so the wizard stays workable
  // locally. There is no way to tell the two apart from a spec without paying
  // for a turn, so that check stays a live one on a preview deploy.

  test.describe('AI task creation', () => {
    // The guard belongs to every case that mounts the panel, not just to the
    // one that hands it a file. Nothing requests the route on mount today
    // (sendMessage is user-driven), and this is what keeps that true: a
    // mount-time greeting or an auto-send would otherwise cost a real turn on
    // every run of every branch, which is precisely what this file's docstring
    // promises it will not do. Aborted rather than merely counted, so a
    // regression cannot be paid for even once.
    let wizardPosts = 0
    test.beforeEach(async ({ page }) => {
      wizardPosts = 0
      await page.route('**/api/admin/ai/task-wizard', route => {
        if (route.request().method() === 'POST') wizardPosts += 1
        return route.abort()
      })
    })

    test('the create dialog hands over to the AI panel and back', async ({ page }) => {
      await gotoTasks(page)
      await listSettled(page)

      await page.getByRole('button', { name: /^New( task)?$/ }).first().click()
      const dialog = page.getByRole('dialog', { name: 'New task' })
      await expect(dialog).toBeVisible({ timeout: 20_000 })

      await dialog.getByRole('button', { name: /Draft with AI/ }).click()

      // The panel is a lazy chunk, so the first mount compiles and downloads.
      // The dialog is NOT the panel: new-task-dialog.tsx renames its own shell
      // to "Draft tasks with AI" the moment the view flips, so this locator
      // goes visible while the chunk is still on the wire. Everything inside
      // needs the same patient wait rather than the 5s default, which is what
      // turned a cold run of this case red.
      const aiDialog = page.getByRole('dialog', { name: 'Draft tasks with AI' })
      await expect(aiDialog).toBeVisible({ timeout: 30_000 })
      await expect(aiDialog.getByRole('progressbar', { name: 'Interview progress' }))
        .toBeVisible({ timeout: 30_000 })
      // Once the progress line is mounted the rest of the panel is in the same
      // render, so these two keep the default.
      await expect(aiDialog.getByRole('textbox', { name: 'Your answer' })).toBeVisible()
      await expect(aiDialog.getByRole('button', { name: 'Attach a brief' })).toBeVisible()

      // The escape hatch, and the form it lands back on.
      await aiDialog.getByRole('button', { name: 'I will write it myself' }).click()
      await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Draft with AI/ })).toBeVisible()

      // Mounting the panel and walking back out costs nothing.
      expect(wizardPosts, 'opening the panel spent a turn').toBe(0)
    })

    test('the paperclip refuses what it cannot read, before any round trip', async ({ page, request }) => {
      await gotoTasks(page)
      await listSettled(page)
      await page.getByRole('button', { name: /^New( task)?$/ }).first().click()
      await page.getByRole('dialog', { name: 'New task' })
        .getByRole('button', { name: /Draft with AI/ }).click()

      const aiDialog = page.getByRole('dialog', { name: 'Draft tasks with AI' })
      await expect(aiDialog).toBeVisible({ timeout: 30_000 })
      // The shell wears the panel's name before the lazy chunk lands, so the
      // paperclip is what proves the panel itself is mounted. Reaching for the
      // input underneath it first would be reaching into the shell.
      await expect(aiDialog.getByRole('button', { name: 'Attach a brief' }))
        .toBeVisible({ timeout: 30_000 })
      const fileInput = aiDialog.locator('input[type="file"]')

      // Over the ceiling: refused on size, in the browser, with the number in
      // the sentence. Six megabytes never leaves the tab.
      await fileInput.setInputFiles({
        name: 'oversized-brief.txt',
        mimeType: 'text/plain',
        buffer: Buffer.alloc(6 * 1024 * 1024, 'a'),
      })
      await expect(aiDialog.getByRole('alert')).toContainText('larger than 5 MB', { timeout: 15_000 })

      // Unreadable rather than oversized, and the sentence has to name the way
      // out. There is no zip reader in a Worker, so PDF is the answer.
      await fileInput.setInputFiles({
        name: 'brief.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('PK'),
      })
      // The Word sentence first, because it is the only half unique to this
      // refusal. The oversize message names PDF too ("A PDF also has to be N
      // pages or fewer") and the alert element is reused, so asserting the
      // escape route first would pass against the message the file before it
      // left on screen.
      await expect(aiDialog.getByRole('alert'))
        .toContainText('Word files cannot be read here yet', { timeout: 15_000 })
      await expect(aiDialog.getByRole('alert')).toContainText('PDF')

      expect(wizardPosts, 'a refused document was sent to the model anyway').toBe(0)

      // The same judgement at the far end, and it is made before the key is
      // consulted, so this costs nothing either. Both ends refusing in the same
      // words is the point: a browser that stopped saying it would not silently
      // start billing for Word files.
      const res = await request.post('/api/admin/ai/task-wizard', {
        data: {
          messages: [{ role: 'user', content: 'Break this brief into tasks.' }],
          document: {
            filename: 'brief.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            dataBase64: 'UEs=',
          },
        },
      })
      expect(res.status(), 'the route accepted a Word file').toBe(415)
      const body = await res.json() as { error?: string }
      expect(body.error ?? '').toContain('PDF')
    })
  })
})
