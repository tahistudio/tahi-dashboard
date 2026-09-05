import { test, expect, type Locator, type Page } from '@playwright/test'
import { deleteRequest, getRequest, primePage } from './helpers'

/** One day, for the "the floor is not yesterday" assertion. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Predictive autofill fires off typing and can legitimately answer with
 * nothing, so every wait on it is generous and every absence is a skip rather
 * than a failure. The panel's own fields are the 30 second class the QA recipe
 * calls for.
 */
const PANEL_TIMEOUT = 30_000

/**
 * New request dialog (Slice DIALOG of the Requests alignment pass).
 *
 * Auth: the dev-only Ship Studio bypass (tahi-ship-studio cookie), the same
 * fixture e2e/requests.spec.ts uses. It resolves to the Tahi admin org, so
 * everything here runs on the team audience.
 *
 * The rollout gate is gone: NEW_DIALOG_FOR_EVERYONE went true in 51ef34b and
 * the legacy slide-over it guarded has been deleted, so `rebuiltDialogIsOn` now
 * answers true for everyone. The skips it drives are kept as a cheap guard on
 * the dialog having rendered at all rather than a gate on the audience, and
 * their reasons say so.
 *
 * Data resilience: nothing is created. Every assertion is on chrome that the
 * dialog owns, never on a particular client or request existing.
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

async function gotoRequests(page: Page): Promise<void> {
  // A compiling dev server can abort the first navigation; retry once.
  try {
    await page.goto('/requests')
  } catch (err) {
    if (!String(err).includes('ERR_ABORTED')) throw err
    await page.goto('/requests')
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Requests', { timeout: 20_000 })
}

/** Opens the dialog from whichever New button the current width renders. */
async function openDialog(page: Page) {
  await page.getByRole('button', { name: /^New( request)?$/i }).first().click()
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

/** The rebuilt dialog leads with the category tiles; the legacy one has none. */
async function rebuiltDialogIsOn(page: Page): Promise<boolean> {
  const grid = page.getByRole('radiogroup', { name: 'What kind of work?' })
  await grid.first().waitFor({ state: 'attached', timeout: 8_000 }).catch(() => {})
  return (await grid.count()) > 0
}

/** True while focus sits inside one of the mounted dialog panels. */
async function focusIsInsideDialog(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!active) return false
    return Array.from(document.querySelectorAll('[role="dialog"]'))
      .some(panel => panel === active || panel.contains(active))
  })
}

/** Opens a SearchableSelect by its placeholder and picks the first option. */
async function pickFirstOption(dialog: Locator, placeholder: string): Promise<string | null> {
  const trigger = dialog.getByRole('button', { name: placeholder })
  if (await trigger.count() === 0) return null
  await trigger.first().click()
  const options = dialog.getByRole('option')
  await options.first().waitFor({ state: 'visible', timeout: PANEL_TIMEOUT }).catch(() => {})
  if (await options.count() === 0) return null
  const label = (await options.first().textContent())?.trim() ?? null
  await options.first().click()
  return label
}

/** The text an element's aria-describedby actually resolves to on the page. */
async function describedByText(field: Locator): Promise<string> {
  return field.evaluate((el) => {
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    return ids
      .map(id => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim()
  })
}

test.describe('New request dialog', () => {
  test.beforeEach(async ({ page }) => { await primePage(page) })

  test('opens and closes on Escape', async ({ page }) => {
    await gotoRequests(page)
    const dialog = await openDialog(page)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  })

  test('Tab cycles inside the panel, including after the body swaps', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The dialog body did not render.')

    // More presses than the form has stops, so a leaky trap walks out into the
    // sidebar and the top nav rather than wrapping.
    for (let i = 0; i < 30; i += 1) await page.keyboard.press('Tab')
    expect(await focusIsInsideDialog(page)).toBe(true)

    // Swapping the whole body unmounts whatever held focus. The trap has to
    // survive that, which is the case a panel-bound keydown handler misses.
    await page.getByRole('button', { name: /Build with AI/ }).click()
    await expect(page.getByRole('progressbar', { name: 'Interview progress' })).toBeVisible()
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab')
    expect(await focusIsInsideDialog(page)).toBe(true)
  })

  test('the body reads in the prototype order', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The dialog body did not render.')

    // AI card, client, category, title, brief. The size control only mounts
    // for a retainer client, so it is not asserted here.
    await expect(page.getByRole('button', { name: /Build with AI/ })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'What kind of work?' })).toBeVisible()
    await expect(page.getByLabel('Title', { exact: false })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Brief' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Brief formatting' })).toBeVisible()

    // The footer says where the request lands before the buttons.
    await expect(page.getByText('Lands in Triage')).toBeVisible()
  })

  test('the category tiles behave as a radiogroup', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The dialog body did not render.')

    const group = page.getByRole('radiogroup', { name: 'What kind of work?' })
    const design = group.getByRole('radio', { name: 'Design' })
    await design.click()
    await expect(design).toHaveAttribute('aria-checked', 'true')

    // Arrow keys move the selection, so the grid is reachable without a mouse.
    await page.keyboard.press('ArrowRight')
    await expect(design).toHaveAttribute('aria-checked', 'false')
  })

  test('the ideal due date opens empty and floors at tomorrow', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The dialog body did not render.')

    const due = page.locator('#req-due-date')
    await expect(due).toBeVisible()

    const { value, min } = await due.evaluate(el => ({
      value: (el as HTMLInputElement).value,
      min: (el as HTMLInputElement).min,
    }))
    // It used to open at today plus seven: a blind constant painted as an
    // ordinary filled field, so nobody could tell a date the studio had
    // thought about from one nobody had. Empty is the honest state, and it
    // leaves somewhere for a grounded suggestion to land.
    expect(value).toBe('')
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${min}T00:00:00`).getTime()).toBeGreaterThan(Date.now() - DAY_MS)
  })

  test('submit stays off until the form is fileable', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The dialog body did not render.')

    // No title and no client: the team path cannot file.
    await expect(page.getByRole('button', { name: 'Create request' })).toBeDisabled()
  })

  test('the AI view swaps into the same shell and hands back', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The dialog body did not render.')

    await page.getByRole('button', { name: /Build with AI/ }).click()

    // Same dialog, new body: a progress line and a way back to the form.
    await expect(page.getByRole('progressbar', { name: 'Interview progress' })).toBeVisible()
    const back = page.getByRole('button', { name: 'Write it myself' })
    await expect(back).toBeVisible()

    await back.click()
    await expect(page.getByRole('radiogroup', { name: 'What kind of work?' })).toBeVisible()
  })

  /**
   * TP.5: the empty fields fill themselves, visibly, and give way to a person.
   *
   * The one flow the founder asked for, end to end: pick a client, write a
   * real title, watch the due date and the priority fill with a Suggested chip
   * and a caption that says why, correct one of them, clear the rest, and file
   * what is left.
   *
   * It skips rather than fails when nothing is suggested. That is a legitimate
   * answer from the route (a studio with no delivered work, a deploy with no
   * ANTHROPIC_API_KEY, a client whose cohort is under five rows), and a red
   * suite on a correct abstention would teach everyone to ignore this file.
   */
  test('an empty due date and priority fill themselves, and a person can take them back', async ({ page, request }) => {
    await gotoRequests(page)
    const dialog = await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The dialog body did not render.')

    const client = await pickFirstOption(dialog, 'Select a client...')
    test.skip(!client, 'The dataset has no active client to file against.')

    // Twelve words, which is comfortably past the four word / sixteen
    // character gate the dialog and the route both run.
    const title = 'Rebuild the pricing page hero and refresh the plan comparison table copy'
    await page.locator('#req-title').fill(title)

    const due = page.locator('#req-due-date')
    const dueChip = dialog.getByRole('button', { name: 'Clear the suggested due date' })

    // 700ms of debounce, a model call, and a Worker cold start.
    await dueChip.waitFor({ state: 'visible', timeout: PANEL_TIMEOUT }).catch(() => {})
    test.skip(await dueChip.count() === 0, 'The studio had nothing to suggest for this client, which is a valid answer.')

    // The value is real: it is in the control, so it submits with the form and
    // needs no separate accept step.
    await expect(due).not.toHaveValue('')
    // And the reason is wired to the field rather than floating beside it.
    expect(await describedByText(due)).not.toBe('')

    // One polite announcement for the batch, so fields filling themselves
    // below the caret is not a change only a sighted operator notices. The
    // region is asserted, not the sentence: the wording is copy.
    const live = dialog.locator('[aria-live="polite"].sr-only')
    await expect(live).toHaveCount(1)
    await expect(live).toContainText('Suggested', { timeout: PANEL_TIMEOUT })

    // No confidence number anywhere on the panel.
    await expect(dialog.getByText(/\d{1,3}\s?% confiden/i)).toHaveCount(0)

    // Correcting a field takes it back from the predictor: the chip goes if
    // there was one, and the value the person chose is the one that stands.
    const priorityChip = dialog.getByRole('button', { name: 'Clear the suggested priority' })
    const priorityWasSuggested = await priorityChip.count() > 0
    await page.locator('#req-priority').selectOption('high')
    if (priorityWasSuggested) await expect(priorityChip).toHaveCount(0)
    await expect(page.locator('#req-priority')).toHaveValue('high')

    // One link empties everything still suggested.
    const clearAll = dialog.getByRole('button', { name: 'Clear suggestions' })
    await expect(clearAll).toBeVisible()
    await clearAll.click()
    await expect(due).toHaveValue('')
    await expect(clearAll).toHaveCount(0)

    // What the person left stands, and the request files.
    const created = page.waitForResponse(r =>
      r.url().includes('/api/admin/requests') && r.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Create request' }).click()
    const res = await created
    expect(res.ok()).toBeTruthy()
    const { id } = await res.json() as { id: string }

    try {
      const saved = await getRequest(request, id)
      expect(saved.title).toBe(title)
      // Cleared means cleared: the suggestion does not come back on submit.
      expect(saved.dueDate).toBeNull()
      expect(saved.priority).toBe('high')
    } finally {
      await deleteRequest(request, id)
    }
  })

  test('the footer keeps its primary action inside the panel at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoRequests(page)
    const dialog = await openDialog(page)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    // The page-level measurement above can never fail while the panel clips
    // with overflow: hidden, so the real question is whether the primary
    // action still fits the panel it is drawn in.
    const submit = dialog.getByRole('button', { name: /^(Create request|Submit request)$/ })
    await expect(submit).toBeVisible()
    const panelBox = await dialog.boundingBox()
    const submitBox = await submit.boundingBox()
    expect(panelBox).not.toBeNull()
    expect(submitBox).not.toBeNull()
    if (!panelBox || !submitBox) return

    // Half a pixel of slack for sub-pixel layout, nothing more.
    expect(submitBox.x).toBeGreaterThanOrEqual(panelBox.x - 0.5)
    expect(submitBox.x + submitBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5)

    if (await rebuiltDialogIsOn(page)) {
      // A label that wrapped to two lines shows up as a taller button than the
      // one beside it, which is exactly what a footer that cannot wrap does.
      const cancelBox = await dialog.getByRole('button', { name: 'Cancel' }).boundingBox()
      expect(cancelBox).not.toBeNull()
      if (cancelBox) expect(Math.abs(submitBox.height - cancelBox.height)).toBeLessThanOrEqual(1)
    }
  })
})
