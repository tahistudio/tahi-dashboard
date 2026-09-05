import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  primePage,
  filterChip,
  createTask,
  deleteTask,
  addBlocker,
  removeBlocker,
  listRequests,
  pickPipelineRequest,
  railCardHead,
  railCardBody,
  expectCardCount,
  type RequestSummary,
} from './helpers'

/**
 * Request detail: the alignment pass (audit findings D1 to D13).
 *
 * Auth: the dev-only Ship Studio bypass (tahi-ship-studio cookie), the same
 * fixture e2e/requests.spec.ts uses. It resolves to the Tahi admin org, so
 * everything here runs as an admin on both the chromium and mobile-safari
 * (iPhone 13) projects.
 *
 * The rebuilt detail is still behind the super-admin gate
 * (`usePermissions().isSuperAdmin`). The bypass user's resolved permission
 * level is not guaranteed, so every test that needs the new UI checks for a
 * marker first and skips with a reason rather than failing. Once the lead
 * flips the gate these skips turn into real coverage with no edit here.
 *
 * Data resilience: nothing asserts that a particular request exists. Anything
 * that needs a row bails out early when the list is empty, and anything that
 * needs a thread message or a scope flag bails out the same way.
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

/** The page body must never scroll sideways (CLAUDE.md Definition of Done). */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/**
 * Open the first request in the list. Returns false when the dataset is
 * empty, so callers can skip instead of failing on someone else's data.
 */
async function openFirstRequest(page: Page): Promise<boolean> {
  // A compiling dev server can abort the first navigation; retry once.
  try {
    await page.goto('/requests')
  } catch (err) {
    if (!String(err).includes('ERR_ABORTED')) throw err
    await page.goto('/requests')
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Requests', { timeout: 20_000 })

  const first = page.locator('a[href^="/requests/"]').first()
  // The rows are fetched client side, so the heading lands a second or two
  // before the first link does. Counting straight after the heading read 0 on
  // a database with seventeen requests in it and skipped this whole file with
  // "No requests in this dataset", which is why the wait is here rather than
  // in the caller. The catch keeps a genuinely empty list a skip, not a fail.
  await first.waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
  if ((await first.count()) === 0) return false

  await first.click()
  // A dev server compiling /requests/[id] on the first hit can hold the client
  // navigation well past 20s, so this waits longer than the list did.
  await expect(page).toHaveURL(/\/requests\/[^/]+$/, { timeout: 45_000 })
  // The shell keeps a notification stream open, so networkidle never fires;
  // wait for the detail rail instead.
  await page.locator('dt').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
  return true
}

/**
 * The rebuilt detail's marker: the spine card, or the note that replaces it
 * on a draft or archived request. Either one means the gate is open.
 */
async function portedDetailIsOn(page: Page): Promise<boolean> {
  const spine = page.getByRole('list', { name: 'Delivery steps' })
  await spine.first().waitFor({ state: 'attached', timeout: 8_000 }).catch(() => {})
  if (await spine.count()) return true
  return (await page.getByText(/This request is (a draft, not yet submitted|archived)\./).count()) > 0
}

function activityFilter(page: Page) {
  return page.getByRole('tablist', { name: 'Activity filter' })
}

/** Straight to one request, rather than through the list. A blocker case has
 *  already chosen its row through the API and cannot take whichever the list
 *  happens to sort first. */
async function gotoRequest(page: Page, id: string): Promise<void> {
  try {
    await page.goto(`/requests/${id}`)
  } catch (err) {
    if (!String(err).includes('ERR_ABORTED')) throw err
    await page.goto(`/requests/${id}`)
  }
  // Sixty seconds, not the list's twenty: on a cold dev server this is the
  // first hit on /requests/[id] and the whole main element is empty until the
  // route has compiled. Measured at over forty-five seconds once.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 })
}

/** The bypass, plus the org to read as. `tahi-impersonate-org` is honoured on
 *  portal GETs only (lib/server-auth.ts), which is exactly the read the leak
 *  check needs and nothing more. Both cookies are sent together because a
 *  Cookie header replaces the stored one rather than adding to it. */
function portalCookie(orgId: string): string {
  return `tahi-ship-studio=1; tahi-impersonate-org=${orgId}`
}

/**
 * A request the portal actually serves.
 *
 * The admin list also holds internal requests and requests whose org has the
 * requests feature turned off, and the portal answers 404 or 403 for both.
 * Asserting "no blocker field" against a 404 body proves nothing, so the leak
 * check picks a row it has watched come back as a 200.
 *
 * The two pipeline candidates are stepped over: this suite and
 * e2e/requests-list.spec.ts are blocking those two in parallel workers, and a
 * shared subject would make one case's cleanup another case's flake.
 */
async function pickPortalVisibleRequest(
  request: APIRequestContext,
): Promise<RequestSummary | null> {
  const rows = await listRequests(request)
  const reserved = new Set(
    [pickPipelineRequest(rows, 0), pickPipelineRequest(rows, 1)]
      .filter((r): r is RequestSummary => r !== null)
      .map(r => r.id),
  )
  for (const row of rows) {
    if (reserved.has(row.id)) continue
    const res = await request.get(`/api/portal/requests/${row.id}`, {
      headers: { Cookie: portalCookie(row.orgId) },
    })
    if (res.ok()) return row
  }
  return null
}

test.describe('Request detail', () => {
  // Every case here pays for two navigations, the second of which compiles
  // /requests/[id] on a cold dev server. The 30s default was being spent
  // before the first assertion ran.
  test.describe.configure({ timeout: 90_000 })

  test.beforeEach(async ({ page }) => { await primePage(page) })

  test('the delivery spine is its own card above the two columns', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')
    test.skip(!(await portedDetailIsOn(page)), 'The rebuilt detail is super-admin gated.')

    const spine = page.getByRole('list', { name: 'Delivery steps' })
    test.skip((await spine.count()) === 0, 'This request is off the delivery pipeline.')

    await expect(spine).toBeVisible()
    // Five pipeline statuses, each drawn as a step.
    expect(await spine.getByRole('listitem').count()).toBe(5)

    // The spine sits between the header card and the grid, so it must start
    // below the title and above the rail.
    const title = page.getByRole('heading', { level: 1 })
    const spineBox = await spine.boundingBox()
    const titleBox = await title.boundingBox()
    expect(spineBox && titleBox && spineBox.y > titleBox.y).toBe(true)

    await expectNoHorizontalScroll(page)
  })

  test('the activity filter reads without expanding the card', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')
    // Header placement is part of the ported card. The legacy card keeps the
    // filter inside the body, where it is only reachable once expanded.
    test.skip(!(await portedDetailIsOn(page)), 'The rebuilt detail is super-admin gated.')

    const filter = activityFilter(page)
    test.skip((await filter.count()) === 0, 'This request has no activity yet.')

    // Visible while the card is still collapsed: it lives in the header row.
    await expect(filter).toBeVisible()

    const comments = filter.getByRole('tab', { name: 'Comments', exact: true })
    const all = filter.getByRole('tab', { name: 'All', exact: true })

    await comments.click()
    await expect(comments).toHaveAttribute('aria-selected', 'true')
    await expect(all).toHaveAttribute('aria-selected', 'false')

    // Choosing a half of the feed also reveals it: the control is clickable
    // while the card is collapsed, so a selection that showed nothing would
    // read as dead.
    await expect(page.locator('#activity-log-body')).toBeVisible()

    // The choice persists: it is written to localStorage under the key the
    // legacy toggle already used.
    expect(await page.evaluate(() => localStorage.getItem('tahi-activity-filter'))).toBe('comments')

    // Put it back so a re-run starts from All.
    await all.click()
    await expect(all).toHaveAttribute('aria-selected', 'true')
    await expectNoHorizontalScroll(page)
  })

  test('the activity filter moves under the arrow keys', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')
    test.skip(!(await portedDetailIsOn(page)), 'The rebuilt detail is super-admin gated.')

    const filter = activityFilter(page)
    test.skip((await filter.count()) === 0, 'This request has no activity yet.')

    const all = filter.getByRole('tab', { name: 'All', exact: true })
    const comments = filter.getByRole('tab', { name: 'Comments', exact: true })

    // click() to set the starting half, then an explicit focus(): the roving
    // tabindex handler lives on the option button, and WebKit (the
    // mobile-safari project) does not focus a button on click, so without this
    // the arrows would go to <body> and never reach the control.
    await all.click()
    await all.focus()
    await page.keyboard.press('ArrowRight')
    await expect(comments).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(all).toHaveAttribute('aria-selected', 'true')
  })

  test('a rail chip is never clipped by its own row', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')
    test.skip(!(await portedDetailIsOn(page)), 'The rebuilt detail is super-admin gated.')

    // Category, not Priority: "Change category" always renders a nowrap
    // CategoryChip, so a clipped row shows up as real overflow. A plain-text
    // value would only prove the point once the span stops wrapping, which
    // makes the assertion vacuous on the rows that carry no chip.
    const trigger = page.getByRole('button', { name: 'Change category' })
    test.skip((await trigger.count()) === 0, 'The Details rail is not editable for this audience.')

    // The regression this guards: the trigger's negative margins used to make
    // its max-width resolve 10px short, so the clipping span ate the right
    // edge of a chip that had room to spare. Measured two ways: the span must
    // not be scrolling, and the chip's own box must sit inside the trigger's
    // content box. 1px of tolerance for sub-pixel rounding.
    const fit = await trigger.first().evaluate(el => {
      const span = el.querySelector('span')
      if (!span) return { scrolls: 0, spill: 0 }
      const chip = span.firstElementChild
      const spill = chip
        ? chip.getBoundingClientRect().right - el.getBoundingClientRect().right
          + parseFloat(getComputedStyle(el).paddingRight)
        : 0
      return { scrolls: span.scrollWidth - span.clientWidth, spill }
    })
    expect(fit.scrolls).toBeLessThanOrEqual(1)
    expect(fit.spill).toBeLessThanOrEqual(1)
  })

  test('the Internal switch states the consequence in words', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')
    test.skip(!(await portedDetailIsOn(page)), 'The rebuilt detail is super-admin gated.')

    const toggle = page.getByRole('switch', { name: 'Internal request' })
    test.skip((await toggle.count()) === 0, 'Actions card is studio-only.')

    await expect(toggle).toBeVisible()
    // The note beside it always says which way round the request currently is.
    await expect(
      page.getByText(/(Hidden from the client portal\.|Visible to .+ in their portal\.)/).first(),
    ).toBeVisible()
    // Read-only assertion: this test never flips client visibility.
    expect(['true', 'false']).toContain(await toggle.getAttribute('aria-checked'))
  })

  test('the brief is above the thread', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')
    test.skip(!(await portedDetailIsOn(page)), 'The rebuilt detail is super-admin gated.')

    const brief = page.getByRole('heading', { name: 'Brief', exact: true })
    test.skip((await brief.count()) === 0, 'This request has no description.')

    const thread = page.getByRole('heading', { name: /^Thread/ })
    const briefBox = await brief.boundingBox()
    const threadBox = await thread.first().boundingBox()
    expect(briefBox && threadBox && briefBox.y < threadBox.y).toBe(true)
  })

  test('a hero meta link opens the list already filtered', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')

    // The status chip in the header is a door to "everything at this status".
    // Both audiences get it, so this needs no gate beyond the data check.
    const statusLink = page.locator('a[href^="/requests?status="]').first()
    test.skip((await statusLink.count()) === 0, 'This request has no status chip.')

    const href = await statusLink.getAttribute('href')
    const status = new URL(href ?? '', 'http://localhost').searchParams.get('status')
    expect(status).toBeTruthy()

    await statusLink.click()
    await expect(page).toHaveURL(new RegExp(`/requests\\?status=${status}$`), { timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Requests', { timeout: 20_000 })

    // The param has to land as a real, clearable filter, not just a URL the
    // list ignores: the chips row is what proves it reached the rail state.
    // The rail select's own clear button carries the same accessible name and
    // comes first in DOM order, so this scopes to the chip rather than taking
    // whichever the page offers (see filterChip in e2e/helpers.ts).
    await expect(filterChip(page, 'status')).toBeVisible({ timeout: 20_000 })

    await expectNoHorizontalScroll(page)
  })

  test('the detail page fits its viewport in both projects', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')
    await expectNoHorizontalScroll(page)
  })

  // ── Blockers ───────────────────────────────────────────────────────────────

  test('the Blocked by card lists a task, the spine grows a chip, and Open lands on the task', async ({ page, request }) => {
    // Two cold routes in one case, /requests/[id] and then /tasks, which on a
    // dev server that has served neither is more than the file's 90s.
    test.slow()

    const target = pickPipelineRequest(await listRequests(request))
    test.skip(!target, 'No open, numbered, uniquely titled request in this dataset to block.')
    if (!target) return

    // One more than whatever the row already carries, rather than a flat 1.
    // A crashed run leaves an orphan link behind (its cleanup never got to
    // run), and the next run then reads 2 and blames the feature. The count
    // the list reports is the same open-blocker count the card prints.
    const expected = (target.blockedByCount ?? 0) + 1

    const title = `Playwright request blocker ${Date.now()}`
    const taskId = await createTask(request, { title })
    let linkId: string | null = null
    try {
      linkId = await addBlocker(request, { type: 'request', id: target.id }, { type: 'task', id: taskId })

      await gotoRequest(page, target.id)

      const head = railCardHead(page, 'Blocked by')
      await expect(head).toBeVisible({ timeout: 45_000 })
      await expectCardCount(head, 'Blocked by', expected)

      // A task blocker wears the task vocabulary, and it carries no ref: only
      // a request has a number.
      const body = railCardBody(page, 'Blocked by')
      await expect(body).toContainText('To Do')
      await expect(body).toContainText(title)

      // The spine takes an amber chip and does NOT grow a sixth node. Both
      // halves, because the chip exists precisely so the pipeline does not
      // have to invent a status that would then disagree with the real one.
      const delivery = page.getByRole('region', { name: 'Delivery', exact: true })
      await expect(delivery.getByText(`Blocked by ${expected}`, { exact: true })).toBeVisible()
      await expect(delivery.getByRole('list', { name: 'Delivery steps' }).getByRole('listitem'))
        .toHaveCount(5)

      // The way in is the same deep link a notification uses, and it has to
      // land on the panel rather than on a bare list.
      await body.getByRole('link', { name: `Open ${title}` }).click()
      await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${taskId}`), { timeout: 45_000 })
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 45_000 })
      await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Task title' }))
        .toHaveValue(title, { timeout: 30_000 })
    } finally {
      if (linkId) await removeBlocker(request, { type: 'request', id: target.id }, linkId)
      await deleteTask(request, taskId)
    }
  })

  test('a blocked request tells a client nothing about it', async ({ request }) => {
    // The leak check, and the most important line in this file. A client must
    // not learn that their request is stuck on three internal task titles, and
    // must not learn the count either: a number alone still says it.
    //
    // This runs at the boundary rather than in the browser. The page is one
    // component for two audiences and the card is gated on `isAdmin` at
    // render, but the Ship Studio bypass pins the admin org for the whole
    // browser context, so a spec cannot BE a client here. What it can do is
    // read the portal endpoint as one: `tahi-impersonate-org` is honoured on
    // portal GETs, which is the same door the studio's own client view uses.
    const candidate = await pickPortalVisibleRequest(request)
    test.skip(!candidate, 'No client-visible request in this dataset to check.')
    if (!candidate) return

    const title = `Playwright leak check ${Date.now()}`
    const taskId = await createTask(request, { title })
    let linkId: string | null = null
    try {
      linkId = await addBlocker(request, { type: 'request', id: candidate.id }, { type: 'task', id: taskId })

      const res = await request.get(`/api/portal/requests/${candidate.id}`, {
        headers: { Cookie: portalCookie(candidate.orgId) },
      })
      expect(res.ok(), 'the portal detail could not be read as the client').toBeTruthy()
      const payload = await res.text()

      // Not "no blockedByCount": no mention of the idea at all, in any key or
      // value, including the blocking task's own title.
      expect(payload.toLowerCase(), 'the portal payload mentions blockers').not.toContain('block')
      expect(payload, 'the portal payload carries a blocking task title').not.toContain(title)

      // And there is no portal door to ask through either. 404, not 403: the
      // route does not exist, which is the refusal Decision 13 describes.
      const direct = await request.get(`/api/portal/requests/${candidate.id}/blockers`, {
        headers: { Cookie: portalCookie(candidate.orgId) },
      })
      expect(direct.status(), 'a portal blockers route answered').toBe(404)
    } finally {
      if (linkId) await removeBlocker(request, { type: 'request', id: candidate.id }, linkId)
      await deleteTask(request, taskId)
    }
  })
})
