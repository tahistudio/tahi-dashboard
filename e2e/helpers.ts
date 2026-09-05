import { expect, type Page } from '@playwright/test'

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
