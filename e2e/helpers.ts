import type { Page } from '@playwright/test'

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
