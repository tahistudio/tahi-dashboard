import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The dev-only Ship Studio auth bypass, as a storageState. Six specs had
 * this block copy-pasted verbatim; it resolves to the Tahi admin org, which
 * is what every admin-surface spec needs.
 */
export const shipStudioStorageState = {
  cookies: [
    {
      name: 'tahi-ship-studio',
      value: '1',
      domain: 'localhost',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    },
  ],
  origins: [],
}

/**
 * Definition-of-Done check: nothing may scroll the page sideways. Run it at
 * 375px on every surface that ships.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(1)
}

/** True on the mobile-safari project, where tables become card lists. */
export async function isNarrow(page: Page): Promise<boolean> {
  return (await page.evaluate(() => window.innerWidth)) < 768
}

/**
 * True when the desktop rail is really on screen.
 *
 * RailLayout's aside is `hidden lg:block` and the Filters button that stands
 * in for it is `lg:hidden`, so the two swap at 1024px, not at the 768px
 * `isNarrow` answers for. A rail case gated on `isNarrow` runs against a
 * display:none aside anywhere between the two, which is out of the
 * accessibility tree and matches nothing. Gate those on the rail's own
 * breakpoint and leave `isNarrow` to the table-versus-cards question its
 * docstring describes.
 */
export async function railIsOnScreen(page: Page): Promise<boolean> {
  return (await page.evaluate(() => window.innerWidth)) >= 1024
}

/**
 * An active filter chip in the toolbar's chip strip.
 *
 * Two controls carry the accessible name "Clear the <dimension> filter" once
 * a filter is set at desktop width: the rail select's own clear button
 * (components/tahi/rail/rail-controls.tsx) and the chip's
 * (components/tahi/rail/rail-layout.tsx). The rail comes first in DOM order,
 * so a bare `getByRole(...).first()` resolves to the select and the chip
 * strip goes unasserted. Only the chip wraps its clear button in a span,
 * which is what this scopes on, so an assertion that says chip means chip.
 */
export function filterChip(page: Page, dimension: string): Locator {
  return page.locator('span').filter({
    has: page.getByRole('button', { name: `Clear the ${dimension} filter` }),
  })
}

/**
 * HTML5 drag and drop, the recipe from the Playwright docs.
 *
 * The Tasks board and the My week planner both move work with native
 * dragstart / dragover / drop, which mouse movement alone does not raise in a
 * headless browser. One DataTransfer travels through every event, so the
 * payload the source writes is the payload the target reads, and the drop
 * lands even if the React state the source set has not flushed yet.
 *
 * Dispatch on the container, never on a card inside it: a card's own drop
 * handler stops the event before the column's ever sees it.
 */
export async function html5DragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  try {
    await source.dispatchEvent('dragstart', { dataTransfer })
    await target.dispatchEvent('dragover', { dataTransfer })
    await target.dispatchEvent('drop', { dataTransfer })
  } finally {
    await dataTransfer.dispose()
  }
}

/**
 * Shared e2e page priming.
 *
 * A fresh browser context looks like a first visit, so the product tour
 * (components/tahi/product-tour.tsx) opens its spotlight over the page and
 * intercepts every click and Tab press. Marking the tour complete before
 * navigation keeps specs honest about the surface they test rather than
 * the onboarding overlay. Origin-agnostic, so it works against any port.
 */
export async function primePage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tahi-tour-complete', '1')
      localStorage.setItem('tahi-tour-seen', '1')
    } catch {
      // Storage can be unavailable in some contexts; the tour then shows.
    }
  })
}
