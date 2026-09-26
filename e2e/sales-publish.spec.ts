import { expect, type APIRequestContext, type Locator } from '@playwright/test'
import {
  bellRowsFor,
  expectNoHorizontalScroll,
  markBellRead,
  primePage,
  skipUnlessMailIsDead,
  testWithStudio as test,
} from './helpers'

/**
 * D3, the sales half: share, publish, view at 375px, accept, studio notified.
 *
 * What Batch C promised and what this holds the live handlers to:
 *
 *   C1 (publish before share). The first share takes a snapshot, and the
 *   public viewer reads that snapshot, never the live rows. A re-share keeps
 *   the existing snapshot rather than silently publishing whatever the studio
 *   has typed since; only Publish re-arms it. A revoke drops the link AND the
 *   snapshot, so the old token 404s and a later share starts from the current
 *   rows instead of resurrecting the first version.
 *
 *   C2 (public viewer integrity). At 375px the package strip overflows and a
 *   person can scroll it to the last tab (the third one used to clip off the
 *   strip with no way to reach it), each tab is a 44px touch target, and
 *   nothing scrolls the page sideways. The packages carry names as long as the
 *   studio really writes them: Starter, Growth and Scale fit inside the strip
 *   at 375px, so with those the overflow never happens and the check would
 *   pass on the pre-fix strip. The spec asserts the overflow before it relies
 *   on it, and reaches the last tab with a sideways wheel rather than a click,
 *   because Playwright scrolls a click's target into view first, and that
 *   scrolls an overflow hidden strip just as happily as the fixed one.
 *
 *   C3 (accept closes the loop). The accept is validated against the published
 *   snapshot, the accepted amounts are frozen onto the acceptance row, the
 *   proposal flips to accepted and refuses a second decision, the studio bell
 *   gets a row, and an expired proposal refuses acceptance with a 410.
 *
 * There is no deal assertion on purpose. The accept route logs a deal activity
 * when the proposal is linked to a deal but deliberately does not move the
 * deal's stage ("a separate, deliberate Liam decision", see
 * app/api/public/proposals/[token]/accept/route.ts), and creating a deal here
 * would leave one more archived deal in the harness pipeline on every run,
 * because deal DELETE is a soft archive.
 *
 * Auth: the studio side is the `studio` fixture (testWithStudio in
 * e2e/helpers.ts), an API context carrying the dev-only Ship Studio bypass.
 * The browser page is deliberately anonymous, like a prospect opening the
 * link from an email.
 *
 * Email: accepting fans out a studio email through lib/email-delivery.ts. The
 * allowlist holds back every address but business@tahi.studio, and the QA
 * harness runs its dev server with RESEND_API_KEY set to a dead value so even
 * that one is refused by Resend. The acceptor address is on example.com, which
 * the allowlist never passes. The file skips unless E2E_DEAD_RESEND_KEY=1 says
 * the server under test holds that dead key (skipUnlessMailIsDead in
 * e2e/helpers.ts), so a plain `npm run test:e2e`, whose dev server reads the
 * live key from .env.local, never mails the studio.
 *
 * Data: every proposal is created here under a unique title and deleted in a
 * finally (or by createProposal itself when a later seed call fails, before
 * the test's finally exists), and its sections, variants and acceptances go
 * with it through the ON DELETE CASCADE the migrations declare. The seeded QA
 * sqlite lost nearly every FK clause in the export it came from (three of its
 * 122 tables keep one), so on that harness the child rows outlive the parent,
 * unreachable from any list. The bell rows are marked read, since the bell has
 * no delete.
 *
 * One project only: the viewport is pinned to 375px for the whole file, so the
 * mobile project would repeat the same fixtures at the same width.
 */

interface VariantSeed {
  name: string
  monthlyAmount: number
  isFeatured?: boolean
}

interface SeededProposal {
  id: string
  /** Variant ids keyed by name. */
  variants: Record<string, string>
}

interface ShareResult {
  token: string
  status: string
  published: boolean
  publishedAt: string | null
}

interface PublicVariant {
  id: string
  name: string
  oneOffAmount: number
  monthlyAmount: number
  currency: string
}

interface PublicProposalRead {
  proposal: { title: string; status: string; decidedVariantId: string | null }
  variants: PublicVariant[]
  expired: boolean
}

interface AcceptanceRow {
  status: string
  variantId: string | null
  acceptorEmail: string | null
  acceptedVariantName: string | null
  acceptedOneOffAmount: number | null
  acceptedMonthlyAmount: number | null
  acceptedCurrency: string | null
}

interface AdminProposalRead {
  proposal: {
    status: string
    publicShareToken: string | null
    publishedAt: string | null
    decidedAt: string | null
    decidedVariantId: string | null
  }
  acceptances: AcceptanceRow[]
}

test.use({ viewport: { width: 375, height: 812 } })

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The viewport is pinned to 375px in this file; a second project would only repeat the same fixtures.',
  )
  skipUnlessMailIsDead()
  await primePage(page)
})

/** Unique per run and per test, so reruns and parallel files never collide. */
function runTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * A proposal with an overview section and the given packages, built through
 * the same admin routes the editor calls. seedDefaults is off so the packages
 * are exactly the ones named here.
 *
 * The caller's finally only exists once this returns, so a section or package
 * that fails to seed deletes the half-built proposal here before the failure
 * goes up.
 */
async function createProposal(
  studio: APIRequestContext,
  opts: { title: string; variants: VariantSeed[]; expiresAt?: string },
): Promise<SeededProposal> {
  const created = await studio.post('/api/admin/proposals', {
    data: {
      title: opts.title,
      preparedFor: 'D3 Prospect Ltd',
      preparedBy: 'Tahi Studio',
      seedDefaults: false,
      ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    },
  })
  expect(created.status(), 'the proposal fixture could not be created').toBe(201)
  const { id } = await created.json() as { id: string }

  try {
    const section = await studio.post(`/api/admin/proposals/${id}/sections`, {
      data: {
        type: 'overview',
        title: 'Executive overview',
        data: { html: '<p>A short overview so the viewer has a page between the cover and the packages.</p>' },
      },
    })
    expect(section.status(), 'the proposal section could not be created').toBe(201)

    const variants: Record<string, string> = {}
    for (const seed of opts.variants) {
      const res = await studio.post(`/api/admin/proposals/${id}/variants`, {
        data: {
          name: seed.name,
          monthlyAmount: seed.monthlyAmount,
          currency: 'NZD',
          isFeatured: seed.isFeatured ?? false,
          scopeHtml: `<ul><li>${seed.name} scope item</li></ul>`,
        },
      })
      expect(res.status(), `the ${seed.name} package could not be created`).toBe(201)
      const body = await res.json() as { id: string }
      variants[seed.name] = body.id
    }
    return { id, variants }
  } catch (err) {
    await deleteProposal(studio, id)
    throw err
  }
}

async function share(studio: APIRequestContext, id: string): Promise<ShareResult> {
  const res = await studio.post(`/api/admin/proposals/${id}/share`)
  expect(res.ok(), 'the share route refused').toBeTruthy()
  return await res.json() as ShareResult
}

async function publish(studio: APIRequestContext, id: string): Promise<void> {
  const res = await studio.post(`/api/admin/proposals/${id}/publish`)
  expect(res.ok(), 'the publish route refused').toBeTruthy()
}

async function revoke(studio: APIRequestContext, id: string): Promise<void> {
  const res = await studio.delete(`/api/admin/proposals/${id}/share`)
  expect(res.ok(), 'the revoke route refused').toBeTruthy()
}

/** A live edit to one package, the kind the studio makes after sharing. */
async function setMonthly(
  studio: APIRequestContext,
  id: string,
  variantId: string,
  monthlyAmount: number,
): Promise<void> {
  const res = await studio.patch(`/api/admin/proposals/${id}/variants/${variantId}`, {
    data: { monthlyAmount },
  })
  expect(res.ok(), 'the package edit was refused').toBeTruthy()
}

async function readAdmin(studio: APIRequestContext, id: string): Promise<AdminProposalRead> {
  const res = await studio.get(`/api/admin/proposals/${id}`)
  expect(res.ok(), `the proposal ${id} could not be read back`).toBeTruthy()
  return await res.json() as AdminProposalRead
}

/** What an anonymous visitor's browser gets for this token. */
async function readPublic(
  request: APIRequestContext,
  token: string,
): Promise<{ status: number; body: PublicProposalRead | null }> {
  const res = await request.get(`/api/public/proposals/${token}`)
  return { status: res.status(), body: res.ok() ? await res.json() as PublicProposalRead : null }
}

/** The monthly price the public link currently shows for one package. */
async function publicMonthly(request: APIRequestContext, token: string, name: string): Promise<number | null> {
  const { body } = await readPublic(request, token)
  return body?.variants.find(v => v.name === name)?.monthlyAmount ?? null
}

/** Soft, for the reason deleteTask is: every call site is in a `finally`. */
async function deleteProposal(studio: APIRequestContext, id: string): Promise<void> {
  const res = await studio.delete(`/api/admin/proposals/${id}`)
  expect.soft(res.ok(), `the proposal fixture ${id} was not cleaned up`).toBeTruthy()
}

/**
 * True when a tab sits wholly inside the part of its strip a person can see
 * (the strip's padding box, where its overflow is cut) and inside the
 * viewport. The viewport alone is too loose: a tab can end short of the
 * screen edge and still be cut off by the strip. Half a pixel of slack covers
 * subpixel layout.
 */
async function isInsideStrip(tab: Locator): Promise<boolean> {
  return tab.evaluate((el) => {
    const strip = el.closest('[role="tablist"]')
    if (!strip) return false
    const box = el.getBoundingClientRect()
    const stripLeft = strip.getBoundingClientRect().left + strip.clientLeft
    const stripRight = stripLeft + strip.clientWidth
    return box.left >= Math.max(stripLeft, 0) - 0.5 && box.right <= Math.min(stripRight, window.innerWidth) + 0.5
  })
}

/** The strip's overflow, measured, so the reachability check cannot pass on a strip that fits. */
async function stripMetrics(strip: Locator): Promise<{ scrollWidth: number; clientWidth: number; overflowX: string; scrollLeft: number }> {
  return strip.evaluate(el => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
    scrollLeft: el.scrollLeft,
  }))
}

test.describe('Proposal share, publish and accept (D3)', () => {
  test('share pins a snapshot, publish re-arms it, and an accept at 375px reaches the studio', async ({ page, request, studio }) => {
    test.setTimeout(180_000)
    const tag = runTag()
    const title = `D3 sales publish ${tag}`
    const acceptorEmail = `d3-acceptor-${tag}@example.com`
    // Long enough to overflow the strip at 375px (about 437px of tabs in a
    // 307px strip on the harness), see the C2 note in the header. The featured
    // package sits in the middle, so the strip bringing it into view on load
    // still leaves the last tab past the strip's edge.
    const STARTER = 'Starter retainer'
    const GROWTH = 'Growth partnership'
    const SCALE = 'Scale enterprise'
    const seeded = await createProposal(studio, {
      title,
      variants: [
        { name: STARTER, monthlyAmount: 900 },
        { name: GROWTH, monthlyAmount: 1500, isFeatured: true },
        { name: SCALE, monthlyAmount: 4000 },
      ],
    })
    const growth = seeded.variants[GROWTH]

    try {
      // ── Share takes the first snapshot ──────────────────────────────────
      const first = await share(studio, seeded.id)
      expect(first.status).toBe('shared')
      expect(first.published, 'the first share must publish a snapshot').toBe(true)
      expect(first.publishedAt).not.toBeNull()
      expect(await publicMonthly(request, first.token, GROWTH)).toBe(1500)

      // A live edit after sharing stays out of the client's view.
      await setMonthly(studio, seeded.id, growth, 1800)
      expect(await publicMonthly(request, first.token, GROWTH), 'an unpublished edit leaked').toBe(1500)

      // Sharing again keeps the link and does not clobber the snapshot.
      const again = await share(studio, seeded.id)
      expect(again.token).toBe(first.token)
      expect(again.published, 'a re-share published edits nobody pressed Publish on').toBe(false)
      expect(await publicMonthly(request, first.token, GROWTH)).toBe(1500)

      // Publish is what re-arms it.
      await publish(studio, seeded.id)
      expect(await publicMonthly(request, first.token, GROWTH), 'publish did not re-arm the snapshot').toBe(1800)

      // And one more live edit, unpublished, which the accept must ignore:
      // the client agrees to the price they were shown, not to this one.
      await setMonthly(studio, seeded.id, growth, 2500)

      // ── The prospect's phone ─────────────────────────────────────────────
      await page.goto(`/p/proposal/${first.token}`)
      await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 60_000 })
      await expectNoHorizontalScroll(page)

      // C2. First the precondition, without which the rest proves nothing:
      // the tabs are wider than the strip, and the last one starts cut off.
      const strip = page.getByRole('tablist')
      await expect(strip.getByRole('tab')).toHaveCount(3)
      const lastTab = strip.getByRole('tab', { name: SCALE, exact: true })
      const before = await stripMetrics(strip)
      expect(before.scrollWidth, 'the package names fit the strip, so there is no overflow to reach past')
        .toBeGreaterThan(before.clientWidth)
      expect(await isInsideStrip(lastTab), `the ${SCALE} tab starts out in view, so reaching it proves nothing`)
        .toBe(false)

      // Then the fix itself: the strip scrolls rather than clips, and a person
      // can move it. A sideways wheel over the strip is that gesture, and it
      // leaves an overflow hidden strip where it was, as the pre-fix one would.
      expect(['auto', 'scroll'], 'the strip clips its overflow instead of scrolling it').toContain(before.overflowX)
      await strip.hover()
      await page.mouse.wheel(1000, 0)
      await expect
        .poll(() => isInsideStrip(lastTab), { message: `a sideways scroll of the strip never brought ${SCALE} into view` })
        .toBe(true)
      expect((await stripMetrics(strip)).scrollLeft, 'the strip itself did not move').toBeGreaterThan(before.scrollLeft)
      await expectNoHorizontalScroll(page)

      // Every tab still selects, stays in view once selected and meets the
      // 44px floor. The click scrolls its own target into view, so this loop
      // is not the reachability proof; the wheel above is.
      for (const name of [STARTER, GROWTH, SCALE]) {
        const tab = strip.getByRole('tab', { name, exact: true })
        await tab.click()
        await expect(tab).toHaveAttribute('aria-selected', 'true')
        await expect.poll(() => isInsideStrip(tab), { message: `the ${name} tab is cut off once selected` }).toBe(true)
        const box = await tab.boundingBox()
        expect(box?.height ?? 0, `the ${name} tab is under the 44px touch floor`).toBeGreaterThanOrEqual(44)
      }
      await expectNoHorizontalScroll(page)

      await strip.getByRole('tab', { name: GROWTH, exact: true }).click()
      await expect(page.getByText('NZ$1,800/mo', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: `Accept ${GROWTH}` }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: `Accept ${GROWTH}` })).toBeVisible()
      await dialog.getByLabel('Your name').fill('Dana Whitlock')
      await dialog.getByLabel('Email', { exact: true }).fill(acceptorEmail)
      await dialog.getByRole('button', { name: 'Confirm acceptance' }).click()

      await expect(page.getByText(`Accepted · ${GROWTH}`)).toBeVisible()
      await expect(page.getByRole('heading', { name: `Welcome aboard, ${GROWTH}` })).toBeVisible()
      await expect(page.getByRole('button', { name: `Accept ${GROWTH}` })).toHaveCount(0)
      await expectNoHorizontalScroll(page)

      // ── The studio heard about it ────────────────────────────────────────
      await expect
        .poll(async () => (await bellRowsFor(studio, 'proposal', seeded.id)).map(row => row.eventType), {
          message: 'no proposal_signed row reached the studio bell',
        })
        .toContain('proposal_signed')
      const [bell] = (await bellRowsFor(studio, 'proposal', seeded.id)).filter(row => row.eventType === 'proposal_signed')
      expect(bell.title).toContain(`accepted "${title}"`)
      expect(bell.body).toBe(GROWTH)

      // ── The record, and the amounts frozen onto it ───────────────────────
      const record = await readAdmin(studio, seeded.id)
      expect(record.proposal.status).toBe('accepted')
      expect(record.proposal.decidedVariantId).toBe(growth)
      expect(record.proposal.decidedAt).not.toBeNull()
      expect(record.acceptances).toHaveLength(1)
      expect(record.acceptances[0]).toMatchObject({
        status: 'accepted',
        variantId: growth,
        acceptorEmail,
        acceptedVariantName: GROWTH,
        acceptedOneOffAmount: 0,
        // The published price, not the 2500 sitting unpublished in the live row.
        acceptedMonthlyAmount: 1800,
        acceptedCurrency: 'NZD',
      })

      // A later edit to the live package cannot rewrite what was agreed.
      await setMonthly(studio, seeded.id, growth, 9999)
      const after = await readAdmin(studio, seeded.id)
      expect(after.acceptances[0].acceptedMonthlyAmount, 'the accepted amount moved after the fact').toBe(1800)

      // The link still opens on the decision, and refuses a second one.
      const decided = await readPublic(request, first.token)
      expect(decided.status).toBe(200)
      expect(decided.body?.proposal.status).toBe('accepted')
      const secondDecision = await request.post(`/api/public/proposals/${first.token}/accept`, {
        data: { status: 'declined' },
      })
      expect(secondDecision.status()).toBe(409)
    } finally {
      await markBellRead(studio, 'proposal', seeded.id)
      await deleteProposal(studio, seeded.id)
    }
  })

  test('revoke 404s the link, and the next share starts from the current rows', async ({ page, request, studio }) => {
    test.setTimeout(120_000)
    const title = `D3 revoke ${runTag()}`
    const seeded = await createProposal(studio, {
      title,
      variants: [{ name: 'Standard', monthlyAmount: 1200, isFeatured: true }],
    })
    const standard = seeded.variants.Standard

    try {
      const first = await share(studio, seeded.id)
      expect((await readPublic(request, first.token)).status).toBe(200)

      await revoke(studio, seeded.id)

      // The old token is gone for every reader: the API, the accept route and
      // the page a prospect would open from their inbox.
      expect((await readPublic(request, first.token)).status, 'a revoked link still reads').toBe(404)
      const lateAccept = await request.post(`/api/public/proposals/${first.token}/accept`, {
        data: { status: 'accepted', variantId: standard },
      })
      expect(lateAccept.status(), 'a revoked link still accepts').toBe(404)
      await page.goto(`/p/proposal/${first.token}`)
      await expect(page.getByRole('heading', { name: "This proposal isn't available" })).toBeVisible({ timeout: 60_000 })
      await expectNoHorizontalScroll(page)

      const revoked = await readAdmin(studio, seeded.id)
      expect(revoked.proposal.status).toBe('draft')
      expect(revoked.proposal.publicShareToken).toBeNull()
      expect(revoked.proposal.publishedAt, 'revoke left the old snapshot behind').toBeNull()

      // Rewrite, then share again. Revoke took the snapshot with it, so this
      // share publishes the rewrite rather than resurrecting the first version.
      await setMonthly(studio, seeded.id, standard, 2100)
      const second = await share(studio, seeded.id)
      expect(second.token).not.toBe(first.token)
      expect(second.published).toBe(true)
      expect(await publicMonthly(request, second.token, 'Standard')).toBe(2100)
      expect((await readPublic(request, first.token)).status, 'the first token came back').toBe(404)
    } finally {
      await deleteProposal(studio, seeded.id)
    }
  })

  test('an expired proposal hides the accept controls and the route refuses it', async ({ page, request, studio }) => {
    test.setTimeout(120_000)
    const title = `D3 expired ${runTag()}`
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const seeded = await createProposal(studio, {
      title,
      expiresAt: yesterday,
      variants: [{ name: 'Standard', monthlyAmount: 1200, isFeatured: true }],
    })

    try {
      const link = await share(studio, seeded.id)
      const read = await readPublic(request, link.token)
      expect(read.status).toBe(200)
      expect(read.body?.expired).toBe(true)

      await page.goto(`/p/proposal/${link.token}`)
      await expect(page.getByText(/This proposal expired on/)).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText('This proposal has expired.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Accept Standard' })).toHaveCount(0)
      await expectNoHorizontalScroll(page)

      // The page hiding the button is a courtesy; the route is the guarantee.
      const refused = await request.post(`/api/public/proposals/${link.token}/accept`, {
        data: { status: 'accepted', variantId: seeded.variants.Standard },
      })
      expect(refused.status()).toBe(410)
      const record = await readAdmin(studio, seeded.id)
      expect(record.proposal.status, 'the route should flip a lapsed proposal to expired').toBe('expired')
      expect(record.acceptances).toHaveLength(0)
    } finally {
      await deleteProposal(studio, seeded.id)
    }
  })
})
