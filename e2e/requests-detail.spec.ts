import { test, expect, type Page } from '@playwright/test'

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
  await page.goto('/requests')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Requests', { timeout: 20_000 })

  const first = page.locator('a[href^="/requests/"]').first()
  if ((await first.count()) === 0) return false

  await first.click()
  await expect(page).toHaveURL(/\/requests\/[^/]+$/, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  return true
}

/**
 * The rebuilt detail's marker: the spine card, or the note that replaces it
 * on a draft or archived request. Either one means the gate is open.
 */
async function portedDetailIsOn(page: Page): Promise<boolean> {
  const spine = page.getByRole('list', { name: 'Delivery steps' })
  if (await spine.count()) return true
  return (await page.getByText(/This request is (a draft, not yet submitted|archived)\./).count()) > 0
}

function activityFilter(page: Page) {
  return page.getByRole('tablist', { name: 'Activity filter' })
}

test.describe('Request detail', () => {
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

    const filter = activityFilter(page)
    test.skip((await filter.count()) === 0, 'This request has no activity yet.')

    // Visible while the card is still collapsed: it lives in the header row.
    await expect(filter).toBeVisible()

    const comments = filter.getByRole('tab', { name: 'Comments', exact: true })
    const all = filter.getByRole('tab', { name: 'All', exact: true })

    await comments.click()
    await expect(comments).toHaveAttribute('aria-selected', 'true')
    await expect(all).toHaveAttribute('aria-selected', 'false')

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

    const filter = activityFilter(page)
    test.skip((await filter.count()) === 0, 'This request has no activity yet.')

    const all = filter.getByRole('tab', { name: 'All', exact: true })
    const comments = filter.getByRole('tab', { name: 'Comments', exact: true })

    await all.click()
    await page.keyboard.press('ArrowRight')
    await expect(comments).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(all).toHaveAttribute('aria-selected', 'true')
  })

  test('a rail chip is never clipped by its own row', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')
    test.skip(!(await portedDetailIsOn(page)), 'The rebuilt detail is super-admin gated.')

    const trigger = page.getByRole('button', { name: 'Change priority' })
    test.skip((await trigger.count()) === 0, 'The Details rail is not editable for this audience.')

    // The regression this guards: the trigger's negative margins used to make
    // its max-width resolve 10px short, so the value span ellipsised a chip
    // that had room to spare. Priority is always "High" or "Standard", short
    // enough that the span must never need to truncate at any rail width.
    const fits = await trigger.first().evaluate(el => {
      const span = el.querySelector('span')
      if (!span) return true
      // 1px of tolerance for sub-pixel rounding at fractional zoom levels.
      return span.scrollWidth <= span.clientWidth + 1
    })
    expect(fits).toBe(true)
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

  test('the detail page fits its viewport in both projects', async ({ page }) => {
    test.skip(!(await openFirstRequest(page)), 'No requests in this dataset.')
    await expectNoHorizontalScroll(page)
  })
})
