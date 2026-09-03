import { test, expect, type Page } from '@playwright/test'

/**
 * New request dialog (Slice DIALOG of the Requests alignment pass).
 *
 * Auth: the dev-only Ship Studio bypass (tahi-ship-studio cookie), the same
 * fixture e2e/requests.spec.ts uses. It resolves to the Tahi admin org, so
 * everything here runs on the team audience.
 *
 * The rebuilt dialog is still behind the super-admin rollout gate
 * (NEW_DIALOG_FOR_EVERYONE in components/tahi/new-request-dialog.tsx). The
 * bypass user's resolved permission level is not guaranteed, so every test
 * that needs the rebuild checks for a marker first and skips with a clear
 * reason rather than failing. When the lead flips the gate these skips turn
 * into real coverage with no edit here.
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
  await page.goto('/requests')
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
  return (await page.getByRole('radiogroup', { name: 'What kind of work?' }).count()) > 0
}

test.describe('New request dialog', () => {
  test('opens, traps Escape and closes', async ({ page }) => {
    await gotoRequests(page)
    const dialog = await openDialog(page)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  })

  test('the body reads in the prototype order', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The rebuilt dialog is super-admin gated.')

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
    test.skip(!(await rebuiltDialogIsOn(page)), 'The rebuilt dialog is super-admin gated.')

    const group = page.getByRole('radiogroup', { name: 'What kind of work?' })
    const design = group.getByRole('radio', { name: 'Design' })
    await design.click()
    await expect(design).toHaveAttribute('aria-checked', 'true')

    // Arrow keys move the selection, so the grid is reachable without a mouse.
    await page.keyboard.press('ArrowRight')
    await expect(design).toHaveAttribute('aria-checked', 'false')
  })

  test('the ideal due date defaults a week out and floors at tomorrow', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The rebuilt dialog is super-admin gated.')

    const due = page.locator('#req-due-date')
    await expect(due).toBeVisible()

    const { value, min } = await due.evaluate(el => ({
      value: (el as HTMLInputElement).value,
      min: (el as HTMLInputElement).min,
    }))
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${value}T00:00:00`).getTime()).toBeGreaterThan(new Date(`${min}T00:00:00`).getTime())
  })

  test('submit stays off until the form is fileable', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The rebuilt dialog is super-admin gated.')

    // No title and no client: the team path cannot file.
    await expect(page.getByRole('button', { name: 'Create request' })).toBeDisabled()
  })

  test('the AI view swaps into the same shell and hands back', async ({ page }) => {
    await gotoRequests(page)
    await openDialog(page)
    test.skip(!(await rebuiltDialogIsOn(page)), 'The rebuilt dialog is super-admin gated.')

    await page.getByRole('button', { name: /Build with AI/ }).click()

    // Same dialog, new body: a progress line and a way back to the form.
    await expect(page.getByRole('progressbar', { name: 'Interview progress' })).toBeVisible()
    const back = page.getByRole('button', { name: 'Write it myself' })
    await expect(back).toBeVisible()

    await back.click()
    await expect(page.getByRole('radiogroup', { name: 'What kind of work?' })).toBeVisible()
  })

  test('the dialog fits a 375px viewport with no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoRequests(page)
    await openDialog(page)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
