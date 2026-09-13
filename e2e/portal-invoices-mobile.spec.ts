import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { expectNoHorizontalScroll, primePage } from './helpers'

/**
 * CB3: client invoices at 375px.
 *
 * A design-review critic flagged the client's Pay now control as "cut in
 * half by the rail" on the invoice list at phone width. Reading the shipped
 * code (components/tahi/portal/invoices/portal-invoice-list.tsx and
 * portal-invoice-detail.tsx) shows the fix already landed: both surfaces
 * swap from a six or five column grid row to a stacked card below the `xl`
 * breakpoint (1280px, chosen deliberately wider than `md` because the old
 * `md` rule left a horizontal scrollbar from 768px to about 1200px with the
 * Pay now action parked off screen behind it), and the row action carries
 * `w-full sm:w-auto` so it spans the card on a phone. This spec is the
 * regression proof that was missing: nothing here asserted any of that
 * before.
 *
 * Auth: the dev-only Ship Studio bypass (`tahi-ship-studio` cookie) plus the
 * admin "Client view" impersonation cookie (`tahi-impersonate-org`), the same
 * pair e2e/requests-detail.spec.ts uses to read a portal route as a named
 * org. `/invoices` and `/invoices/[id]` both branch on this exact pair
 * (see the two page.tsx files) straight to <PortalInvoiceList> /
 * <PortalInvoiceDetail> in `preview` mode, which is the real client surface
 * with every write control disabled, not a stand-in.
 *
 * Data resilience: nothing here assumes a particular org or invoice exists.
 * findClientInvoice walks the admin invoice list and the portal projection
 * for each org it names, and the tests skip with a named reason when the
 * dataset has nothing to check, rather than failing on someone else's data.
 */

interface AdminInvoiceRow {
  id: string
  orgId: string
}

interface PortalInvoiceRow {
  id: string
  payUrl: string | null
  howToPay?: unknown
}

interface InvoiceCandidate {
  orgId: string
  invoiceId: string
}

const SHIP_STUDIO_COOKIE = 'tahi-ship-studio=1'

/** The pair Client view sets on the browser, read through lib/preview-cookie.ts. */
function clientViewCookie(orgId: string): string {
  return `${SHIP_STUDIO_COOKIE}; tahi-impersonate-org=${orgId}`
}

/**
 * Any org with at least one invoice, preferring one whose portal projection
 * carries a Pay now link or a How to pay block: that is the exact control
 * this spec exists to protect. Falls back to the first org with any invoice
 * at all, so the page-level "no horizontal scroll" assertions still run even
 * when nothing in the dataset happens to be payable today.
 */
async function findClientInvoice(request: APIRequestContext): Promise<InvoiceCandidate | null> {
  const adminRes = await request.get('/api/admin/invoices?status=all', {
    headers: { Cookie: SHIP_STUDIO_COOKIE },
  })
  if (!adminRes.ok()) return null
  const adminBody = await adminRes.json() as { items?: AdminInvoiceRow[] }
  const orgIds = [...new Set((adminBody.items ?? []).map(row => row.orgId).filter(Boolean))]

  let fallback: InvoiceCandidate | null = null
  for (const orgId of orgIds) {
    const portalRes = await request.get('/api/portal/invoices?page=1', {
      headers: { Cookie: clientViewCookie(orgId) },
    })
    if (!portalRes.ok()) continue
    const portalBody = await portalRes.json() as { items?: PortalInvoiceRow[] }
    const rows = portalBody.items ?? []
    if (rows.length === 0) continue
    if (!fallback) fallback = { orgId, invoiceId: rows[0].id }
    const actionable = rows.find(row => row.payUrl || row.howToPay)
    if (actionable) return { orgId, invoiceId: actionable.id }
  }
  return fallback
}

/** The one thing a row or the hero wants the client to do, whichever state
 *  the invoice happens to be in. Matches RowAction and the hero action stack
 *  in portal-invoice-detail.tsx: Pay now / Pay {amount}, How to pay, Pay by
 *  card instead, Open invoice, View receipt. `.first()` at the call site picks
 *  the one nearest the top, which is always the primary control on the page. */
const MONEY_ACTION_NAME = /^(Pay|How to pay|Open invoice|View receipt)/

async function primaryMoneyAction(page: Page) {
  return page
    .getByRole('button', { name: MONEY_ACTION_NAME })
    .or(page.getByRole('link', { name: MONEY_ACTION_NAME }))
    .first()
}

/** Fully inside the 375px viewport, and (per the house rule) at least 44px
 *  (2.75rem) tall, the touch target floor `.tahi-btn-sm/-md/-lg` enforce
 *  below the 48rem breakpoint (app/globals.css). */
async function expectOnScreenTouchTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 15_000 })
  const box = await locator.boundingBox()
  expect(box, 'the control has no box').not.toBeNull()
  if (!box) return
  expect(box.x, 'the control starts left of the viewport').toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, 'the control spills past the 375px viewport').toBeLessThanOrEqual(376)
  expect(box.height, 'the control misses the 44px touch target floor').toBeGreaterThanOrEqual(44)
}

test.describe('Client invoices at 375px (CB3)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('invoice list: no horizontal scroll and the row action is fully on screen', async ({
    page,
    request,
    context,
  }) => {
    const candidate = await findClientInvoice(request)
    test.skip(!candidate, 'No client invoice in this dataset to check.')
    if (!candidate) return

    await primePage(page)
    await context.addCookies([
      { name: 'tahi-ship-studio', value: '1', domain: 'localhost', path: '/' },
      { name: 'tahi-impersonate-org', value: candidate.orgId, domain: 'localhost', path: '/' },
    ])

    await page.goto('/invoices')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Invoices', { timeout: 20_000 })

    const action = await primaryMoneyAction(page)
    await expectOnScreenTouchTarget(action)

    // The whole page, not just the control: a wide row can still force the
    // body to scroll sideways even when the button itself sits on screen.
    await expectNoHorizontalScroll(page)
  })

  test('invoice detail: no horizontal scroll, the hero action, How to pay rows and line items all fit', async ({
    page,
    request,
    context,
  }) => {
    const candidate = await findClientInvoice(request)
    test.skip(!candidate, 'No client invoice in this dataset to check.')
    if (!candidate) return

    await primePage(page)
    await context.addCookies([
      { name: 'tahi-ship-studio', value: '1', domain: 'localhost', path: '/' },
      { name: 'tahi-impersonate-org', value: candidate.orgId, domain: 'localhost', path: '/' },
    ])

    await page.goto(`/invoices/${candidate.invoiceId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })

    const action = await primaryMoneyAction(page)
    await expectOnScreenTouchTarget(action)

    // The How to pay block, when this invoice has one: every Copy button
    // (PortalCopyRow, components/tahi/portal/portal-money-kit.tsx) fits
    // within the viewport rather than trailing off the edge of a copy row
    // that wrapped onto its own line.
    const copyButtons = page.getByRole('button', { name: /^Copy /i })
    const copyCount = await copyButtons.count()
    for (let i = 0; i < copyCount; i++) {
      const box = await copyButtons.nth(i).boundingBox()
      if (!box) continue
      expect(box.x + box.width, 'a How to pay Copy control spills past the viewport').toBeLessThanOrEqual(376)
    }

    // The line-item table's mobile card: every visible Ask control fits, the
    // same 44px-and-on-screen check as the hero action.
    const askButtons = page.getByRole('button', { name: 'Ask' })
    const askCount = await askButtons.count()
    for (let i = 0; i < askCount; i++) {
      const ask = askButtons.nth(i)
      if (!(await ask.isVisible())) continue
      const box = await ask.boundingBox()
      if (!box) continue
      expect(box.x + box.width, 'a line-item Ask control spills past the viewport').toBeLessThanOrEqual(376)
      expect(box.height, 'a line-item Ask control misses the 44px touch target floor').toBeGreaterThanOrEqual(44)
    }

    await expectNoHorizontalScroll(page)
  })
})
