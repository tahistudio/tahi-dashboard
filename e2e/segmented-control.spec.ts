import { test, expect, type Locator } from '@playwright/test'

/**
 * Segmented control (components/tahi/segmented-control.tsx), the live half.
 *
 * The Vitest suite (components/tahi/__tests__/segmented-control.test.tsx)
 * runs without a DOM and covers the SSR markup and the pure helpers; this
 * spec drives the /design-system showcase in a real browser for the three
 * behaviours that need one: the pill sits on the active option and follows
 * a click without sliding in from the track's left edge on mount, arrow
 * keys move the selection and focus in tablist mode, and a disabled option
 * cannot be selected by click or keyboard.
 *
 * Auth: the dev-only Ship Studio bypass cookie, as in settings-smoke.spec.ts.
 * It resolves to the Tahi admin org, which /design-system requires.
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

interface Geometry {
  x: number
  width: number
}

interface ReadySnapshot {
  transform: string
  animating: boolean
}

type ProbeWindow = Window & { __segReady?: ReadySnapshot }

/** The pill's translateX and width as the browser computed them. */
function pillGeometry(pill: Locator): Promise<Geometry> {
  return pill.evaluate(el => {
    const cs = getComputedStyle(el)
    const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform)
    return { x: m.m41, width: parseFloat(cs.width) }
  })
}

/** The option button's offset inside the track, which is what the pill targets. */
function buttonGeometry(button: Locator): Promise<Geometry> {
  return button.evaluate(el => {
    const node = el as HTMLElement
    return { x: node.offsetLeft, width: node.offsetWidth }
  })
}

test.describe('Segmented control', () => {
  test('the pill sits on the active tab and follows a click without a mount slide-in', async ({ page }) => {
    // Catch the moment the transition switches on. A MutationObserver
    // callback runs before the browser's next style recalc, so the
    // getComputedStyle read here is that recalc, and a transition that
    // would start from it shows up in getAnimations(). Installed before
    // navigation so a hydration that finishes before load cannot be missed.
    await page.addInitScript(() => {
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const el = record.target as HTMLElement
          if (
            el.classList.contains('tahi-seg-pill') &&
            el.dataset.state === 'ready' &&
            el.closest('[aria-label="Requests view"]')
          ) {
            const transform = getComputedStyle(el).transform
            ;(window as ProbeWindow).__segReady = { transform, animating: el.getAnimations().length > 0 }
            observer.disconnect()
            return
          }
        }
      })
      observer.observe(document, { attributes: true, subtree: true, attributeFilter: ['data-state'] })
    })

    await page.goto('/design-system')
    const strip = page.getByRole('tablist', { name: 'Requests view', exact: true })
    await expect(strip).toBeVisible({ timeout: 15_000 })
    const pill = strip.locator('.tahi-seg-pill')
    await expect(pill).toHaveAttribute('data-state', 'ready')

    const list = strip.getByRole('tab', { name: 'List', exact: true })
    const kanban = strip.getByRole('tab', { name: 'Kanban', exact: true })
    await expect(list).toHaveAttribute('aria-selected', 'true')

    // Mount: the first ready position was committed with the transition off.
    const ready = await page.evaluate(() => (window as ProbeWindow).__segReady)
    expect(ready).toBeDefined()
    expect(ready?.transform).not.toBe('none')
    expect(ready?.animating).toBe(false)

    const before = await pillGeometry(pill)
    const listBox = await buttonGeometry(list)
    expect(Math.abs(before.x - listBox.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(before.width - listBox.width)).toBeLessThanOrEqual(1)

    // Click: selection moves and the pill glides (a real transition) to it.
    await kanban.click()
    await expect(kanban).toHaveAttribute('aria-selected', 'true')
    await expect(list).toHaveAttribute('aria-selected', 'false')
    const gliding = await pill.evaluate(el => {
      void getComputedStyle(el).transform
      return el.getAnimations().length > 0
    })
    expect(gliding).toBe(true)

    const kanbanBox = await buttonGeometry(kanban)
    expect(kanbanBox.x).toBeGreaterThan(listBox.x)
    await expect.poll(async () => (await pillGeometry(pill)).x, { timeout: 3_000 }).toBeCloseTo(kanbanBox.x, 0)
    await expect.poll(async () => (await pillGeometry(pill)).width, { timeout: 3_000 }).toBeCloseTo(kanbanBox.width, 0)
  })

  test('arrow keys move the selection and focus in tablist mode', async ({ page }) => {
    await page.goto('/design-system')
    const strip = page.getByRole('tablist', { name: 'Requests view', exact: true })
    await expect(strip).toBeVisible({ timeout: 15_000 })
    const tab = (name: string) => strip.getByRole('tab', { name, exact: true })

    await tab('List').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab('Kanban')).toBeFocused()
    await expect(tab('Kanban')).toHaveAttribute('aria-selected', 'true')
    await expect(tab('Kanban')).toHaveAttribute('tabindex', '0')
    await expect(tab('List')).toHaveAttribute('aria-selected', 'false')
    await expect(tab('List')).toHaveAttribute('tabindex', '-1')

    await page.keyboard.press('End')
    await expect(tab('Timeline')).toBeFocused()
    await expect(tab('Timeline')).toHaveAttribute('aria-selected', 'true')

    // Arrows wrap at both ends.
    await page.keyboard.press('ArrowRight')
    await expect(tab('List')).toBeFocused()
    await expect(tab('List')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(tab('Timeline')).toBeFocused()
    await expect(tab('Timeline')).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Home')
    await expect(tab('List')).toBeFocused()
    await expect(tab('List')).toHaveAttribute('aria-selected', 'true')
  })

  test('a disabled option cannot be selected by click or keyboard', async ({ page }) => {
    await page.goto('/design-system')
    const group = page.getByRole('radiogroup', { name: 'Request size, no large track', exact: true })
    await expect(group).toBeVisible({ timeout: 15_000 })
    const small = group.getByRole('radio', { name: 'Small', exact: true })
    const large = group.getByRole('radio', { name: 'Large', exact: true })
    await expect(small).toHaveAttribute('aria-checked', 'true')
    await expect(large).toHaveAttribute('aria-disabled', 'true')
    await expect(large).toHaveAttribute('tabindex', '-1')

    // force: Playwright's actionability check would otherwise wait on
    // aria-disabled; the point is that the click lands and does nothing.
    await large.click({ force: true })
    await expect(large).toHaveAttribute('aria-checked', 'false')
    await expect(small).toHaveAttribute('aria-checked', 'true')

    // Keys skip it: Small is the only enabled option, so nothing moves.
    await small.focus()
    await page.keyboard.press('ArrowRight')
    await expect(small).toBeFocused()
    await expect(small).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('End')
    await expect(small).toBeFocused()
    await expect(large).toHaveAttribute('aria-checked', 'false')

    // Space on the disabled button fires click; the guard drops it too.
    await large.focus()
    await page.keyboard.press('Space')
    await expect(large).toHaveAttribute('aria-checked', 'false')
    await expect(small).toHaveAttribute('aria-checked', 'true')

    const pill = group.locator('.tahi-seg-pill')
    const smallBox = await buttonGeometry(small)
    expect(Math.abs((await pillGeometry(pill)).x - smallBox.x)).toBeLessThanOrEqual(1)
  })
})
