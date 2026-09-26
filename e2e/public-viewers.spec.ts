import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import {
  bellRowsFor,
  expectNoHorizontalScroll,
  markBellRead,
  primePage,
  skipUnlessMailIsDead,
  testWithStudio as test,
} from './helpers'

/**
 * D3, the contract half: send, sign on a phone, signed PDF, studio notified.
 *
 * The reviewer's blocker on C2 was that nothing drove the public contract
 * viewer in a browser. This does, at 375px, against the live handlers:
 *
 *   - A contract with two signers is created and sent through the admin
 *     routes. The send route mints the share token and hands back one sign
 *     path per signer; it mails nobody (see its own header).
 *   - The client signer opens their link at 375px on a touch screen, draws a
 *     signature with a finger on the real canvas, ticks the intent box and
 *     submits. The pad has to take the stroke as touch pointer events without
 *     the browser cancelling it to scroll the page (its touch-action), which a
 *     mouse stroke never tests. The page flips to "Your signature is in" and
 *     the studio bell gets a partial row.
 *   - The studio signer opens theirs in a browser whose dashboard theme is
 *     dark (localStorage tahi-theme=dark before the first paint, which is what
 *     the root layout's blocking script reads), and signs with a mouse. The
 *     public layout has to strip that `.dark` class so the deliverable renders
 *     in its own light theme, and the text has to stay readable. They sign;
 *     the page reads Fully signed.
 *
 *     What this does not catch: the class is on <html> from the blocking
 *     script until the public layout's effect removes it after hydration
 *     (app/p/layout.tsx), so a dark first frame is still possible. The check
 *     that the root layout applied the class records exactly that window; the
 *     spec does not fail on it, because that is how the layout works today.
 *   - The document is signed with a final hash, both signatures carry a body
 *     hash, the stamped PDF is in R2 at contracts/<id>/signed.pdf and served
 *     by both the admin and the token-scoped download routes, and the bell has
 *     the final row.
 *
 * Then the two refusals the sign route owes: a cancelled contract 410s every
 * read and write, and a contract past its expiry refuses the signature (and
 * flips to expired) even though the page, which never looks at the date, lets
 * the signer draw one first.
 *
 * Email and the signed PDF. The final signature starts the fully-signed fan
 * out (lib/contract-fully-signed-emails.ts), which renders the PDF, writes it
 * to R2 and only then mails it. That function returns before the R2 write when
 * RESEND_API_KEY is unset, so on a key-less server signedStorageKey stays null
 * until somebody downloads the PDF. The QA harness therefore runs its dev
 * server with RESEND_API_KEY set to a dead value: the PDF is written, and
 * every send is refused by Resend (the allowlist already holds back every
 * address but business@tahi.studio, and every signer here is on example.com).
 * The file skips unless E2E_DEAD_RESEND_KEY=1 says the server holds that dead
 * key (skipUnlessMailIsDead in e2e/helpers.ts).
 *
 * Data: every contract is created here under a unique name and deleted in a
 * finally, and its signers and signatures go with it through the ON DELETE
 * CASCADE the migrations declare (the seeded QA sqlite lost those clauses, see
 * e2e/sales-publish.spec.ts). The stamped PDF stays in the local R2 bucket,
 * which has no delete route; the bell rows are marked read.
 *
 * One project only: the viewport is pinned to 375px for the whole file.
 */

interface SignerSeed {
  role: 'client' | 'tahi'
  name: string
  email: string
}

interface SentSigner {
  id: string
  name: string
  email: string
  status: string
  signPath: string
}

interface ContractRead {
  contract: {
    status: string
    signedAt: string | null
    finalHash: string | null
    signedStorageKey: string | null
  }
  signers: Array<{ id: string; status: string }>
  signatures: Array<{ signerId: string; signatureDataUrl: string; bodyHash: string | null; chainHash: string }>
}

interface Point {
  x: number
  y: number
}

/** What the pad heard during a touch stroke. */
interface PadPointers {
  touchDowns: number
  touchMoves: number
  cancels: number
}

/** A 1x1 transparent PNG, the smallest thing the sign route accepts. */
const TINY_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** WCAG AA for body text. */
const MIN_CONTRAST = 4.5

const PHONE = { width: 375, height: 812 }

/**
 * A touch screen as well as the phone's width, so the client signer can sign
 * with a finger. Mouse input still works in the same page, and the dark mode
 * context below is opened without touch, so both input paths get a signer.
 */
test.use({ viewport: PHONE, hasTouch: true })

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The viewport is pinned to 375px in this file; a second project would only repeat the same fixtures.',
  )
  skipUnlessMailIsDead()
  await primePage(page)
})

function runTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function bodyHtml(clause: string): string {
  return [
    '<h2>Services</h2>',
    `<p>${clause}</p>`,
    '<h2>Payment</h2>',
    '<p>Invoices are payable within fourteen days of issue.</p>',
  ].join('')
}

async function createContract(
  studio: APIRequestContext,
  opts: { name: string; clause: string; signers: SignerSeed[]; expiresAt?: string },
): Promise<string> {
  const res = await studio.post('/api/admin/contracts', {
    data: {
      name: opts.name,
      type: 'msa',
      bodyHtml: bodyHtml(opts.clause),
      signers: opts.signers,
      ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    },
  })
  expect(res.status(), 'the contract fixture could not be created').toBe(201)
  const { id } = await res.json() as { id: string }
  return id
}

async function sendContract(
  studio: APIRequestContext,
  id: string,
): Promise<{ token: string; signers: SentSigner[] }> {
  const res = await studio.post(`/api/admin/contracts/${id}/send`)
  expect(res.ok(), 'the send route refused').toBeTruthy()
  return await res.json() as { token: string; signers: SentSigner[] }
}

async function readContract(studio: APIRequestContext, id: string): Promise<ContractRead> {
  const res = await studio.get(`/api/admin/contracts/${id}`)
  expect(res.ok(), `the contract ${id} could not be read back`).toBeTruthy()
  return await res.json() as ContractRead
}

async function contractStatus(studio: APIRequestContext, id: string): Promise<string> {
  return (await readContract(studio, id)).contract.status
}

/** Soft, for the reason deleteTask is: every call site is in a `finally`. */
async function deleteContract(studio: APIRequestContext, id: string): Promise<void> {
  const res = await studio.delete(`/api/admin/contracts/${id}`)
  expect.soft(res.ok(), `the contract fixture ${id} was not cleaned up`).toBeTruthy()
}

function signerNamed(signers: SentSigner[], name: string): SentSigner {
  const signer = signers.find(s => s.name === name)
  if (!signer) throw new Error(`the send route returned no signer called ${name}`)
  return signer
}

async function bellEvents(studio: APIRequestContext, contractId: string): Promise<string[]> {
  return (await bellRowsFor(studio, 'contract', contractId)).map(row => row.eventType)
}

/** Moves between two waypoints, for both the mouse and the finger. */
const STROKE_STEPS = 8

/**
 * Draw a signature on the pad with a real pointer, a mouse or a finger.
 *
 * The pad sits in a FadeSection that lifts 0.625rem into place as it scrolls
 * into view, so the stroke waits for that to settle: a box read mid-lift would
 * put the pointer a few pixels off the canvas the handlers measure against.
 */
async function drawSignature(page: Page, via: 'mouse' | 'touch'): Promise<void> {
  const canvas = page.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  await expect
    .poll(() => canvas.evaluate((el) => {
      const section = el.closest('section')
      if (!section) return false
      const style = getComputedStyle(section)
      const settled = style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)'
      return style.opacity === '1' && settled
    }), { message: 'the signature pad never settled into view' })
    .toBe(true)

  const box = await canvas.boundingBox()
  if (!box) throw new Error('the signature pad has no box')
  const y = box.y + box.height * 0.45
  const waypoints: Point[] = [
    { x: box.x + box.width * 0.15, y },
    { x: box.x + box.width * 0.35, y: y - box.height * 0.2 },
    { x: box.x + box.width * 0.55, y: y + box.height * 0.15 },
    { x: box.x + box.width * 0.8, y: y - box.height * 0.1 },
  ]

  if (via === 'touch') {
    await touchStroke(page, waypoints)
    return
  }
  const [start, ...rest] = waypoints
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: STROKE_STEPS })
  await page.mouse.up()
}

/**
 * One finger drag through the waypoints.
 *
 * Playwright's touchscreen only taps, so the drag goes through the DevTools
 * protocol, which Chromium turns into pointer events with pointerType "touch"
 * and runs past the page's touch-action the way a phone would. Needs a context
 * with hasTouch, which this file sets.
 */
async function touchStroke(page: Page, waypoints: Point[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const [start, ...rest] = waypoints
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    let from = start
    for (const to of rest) {
      for (let step = 1; step <= STROKE_STEPS; step += 1) {
        const t = step / STROKE_STEPS
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }],
        })
      }
      from = to
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
}

/**
 * Start counting the pointer events the pad receives. A touch stroke has to
 * arrive as touch pointers, and none of it may be cancelled: a pad that let
 * the browser pan gets a pointercancel a few pixels in and keeps only a stub
 * of the signature. The ink count alone misses that. On the harness the pad
 * as built hears all 24 moves and no cancel; with touch-action auto injected
 * it hears 2 moves and one pointercancel, and still inks about 60 pixels.
 * Moves are counted with their coalesced events, so a busy machine folding
 * several into one frame cannot read as a short stroke.
 */
async function watchPad(page: Page): Promise<void> {
  await page.locator('canvas').evaluate((el) => {
    const counts = { touchDowns: 0, touchMoves: 0, cancels: 0 }
    ;(window as Window & { __padPointers?: typeof counts }).__padPointers = counts
    el.addEventListener('pointerdown', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') counts.touchDowns += 1
    })
    el.addEventListener('pointermove', (e) => {
      const move = e as PointerEvent
      if (move.pointerType === 'touch') counts.touchMoves += Math.max(move.getCoalescedEvents?.().length ?? 0, 1)
    })
    el.addEventListener('pointercancel', () => { counts.cancels += 1 })
  })
}

async function padPointers(page: Page): Promise<PadPointers> {
  const counts = await page.evaluate(() => (window as Window & { __padPointers?: PadPointers }).__padPointers)
  if (!counts) throw new Error('watchPad was not called before the stroke')
  return counts
}

/** How many pixels on the pad carry ink, so an empty stroke cannot pass. */
async function inkedPixels(page: Page): Promise<number> {
  return page.locator('canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let inked = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) inked += 1
    return inked
  })
}

/** Both pad buttons at or over the 44px touch floor. */
async function expectPadTouchTargets(page: Page): Promise<void> {
  for (const name of ['Clear', 'Sign and submit']) {
    const box = await page.getByRole('button', { name }).boundingBox()
    expect(box?.height ?? 0, `${name} is under the 44px touch floor`).toBeGreaterThanOrEqual(44)
  }
}

async function signAs(page: Page, signerName: string, via: 'mouse' | 'touch'): Promise<void> {
  if (via === 'touch') await watchPad(page)
  await drawSignature(page, via)
  if (via === 'touch') {
    const heard = await padPointers(page)
    expect(heard.touchDowns, 'the finger never reached the pad as a touch pointer').toBeGreaterThan(0)
    expect(heard.touchMoves, 'the pad heard almost none of the finger stroke').toBeGreaterThan(STROKE_STEPS)
    expect(heard.cancels, 'the browser cancelled the stroke to scroll the page').toBe(0)
  }
  expect(await inkedPixels(page), 'the stroke left no ink on the pad').toBeGreaterThan(50)
  await page.getByRole('checkbox', { name: new RegExp(`I am ${signerName}`) }).check()
  await page.getByRole('button', { name: 'Sign and submit' }).click()
}

/**
 * WCAG contrast of an element's text against what is painted behind it: every
 * background colour from the element up to the first opaque one, translucent
 * layers composited over the ones beneath (white when nothing is opaque), and
 * the text colour composited over that. Gradients are background-image, not
 * background-color, so an element on a gradient reads through to the colour
 * under it; every element this is pointed at sits on a flat fill.
 *
 * Fails closed: a colour it cannot parse (oklch, color(), color-mix) throws
 * instead of reading as transparent black, which would pass dark text on
 * anything light.
 */
async function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    type Rgba = [number, number, number, number]
    function rgba(value: string): Rgba {
      const match = value.trim().match(/^rgba?\(([^)]+)\)$/)
      const parts = match ? match[1].split(/[\s,/]+/).filter(Boolean).map(Number) : []
      if (parts.length < 3 || parts.length > 4 || parts.some(part => Number.isNaN(part))) {
        throw new Error(`contrastOf cannot read the colour "${value}"; teach it the format rather than guess`)
      }
      return [parts[0], parts[1], parts[2], parts.length === 4 ? parts[3] : 1]
    }
    /** Source-over: `top` painted on `under`. */
    function over(top: Rgba, under: Rgba): Rgba {
      const alpha = top[3] + under[3] * (1 - top[3])
      if (alpha === 0) return [0, 0, 0, 0]
      const mix = (i: number) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / alpha
      return [mix(0), mix(1), mix(2), alpha]
    }
    function luminance(colour: Rgba): number {
      const channel = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2])
    }

    const layers: Rgba[] = []
    for (let node: Element | null = el; node; node = node.parentElement) {
      const colour = rgba(getComputedStyle(node).backgroundColor)
      if (colour[3] > 0) layers.push(colour)
      if (colour[3] >= 1) break
    }
    let bg: Rgba = [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i -= 1) bg = over(layers[i], bg)
    const fg = over(rgba(getComputedStyle(el).color), bg)

    const a = luminance(fg)
    const b = luminance(bg)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}

test.describe('Contract send, sign and signed PDF (D3)', () => {
  test('two signers sign at 375px, one in dark mode, and the signed PDF is stored', async ({ page, browser, baseURL, request, studio }) => {
    test.setTimeout(240_000)
    const tag = runTag()
    const name = `D3 signing ${tag}`
    const clause = `Tahi Studio will design and build the ${tag} marketing site.`
    const client: SignerSeed = { role: 'client', name: 'Dana Whitlock', email: `d3-client-${tag}@example.com` }
    const studioSide: SignerSeed = { role: 'tahi', name: 'Sam Rivera', email: `d3-studio-${tag}@example.com` }
    const id = await createContract(studio, { name, clause, signers: [client, studioSide] })

    try {
      const sent = await sendContract(studio, id)
      expect(await contractStatus(studio, id)).toBe('sent')
      const clientLink = signerNamed(sent.signers, client.name)
      const studioLink = signerNamed(sent.signers, studioSide.name)

      // ── The client signs on a phone with a finger, light theme ───────────
      await page.goto(clientLink.signPath)
      await expect(page.getByRole('heading', { name: 'Dana, draw your signature' })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText(clause)).toBeVisible()
      await expectNoHorizontalScroll(page)
      await expectPadTouchTargets(page)

      await signAs(page, client.name, 'touch')
      await expect(page.getByRole('heading', { name: 'Your signature is in' })).toBeVisible()
      await expect(page.getByText('1 of 2 signed so far.')).toBeVisible()
      await expectNoHorizontalScroll(page)

      await expect.poll(() => contractStatus(studio, id)).toBe('partially_signed')
      await expect
        .poll(() => bellEvents(studio, id), { message: 'the partial signature never reached the studio bell' })
        .toContain('contract_partially_signed')

      // ── The studio signs with a mouse, dashboard theme dark ──────────────
      const dark = await browser.newContext({ viewport: PHONE, baseURL })
      try {
        const darkPage = await dark.newPage()
        await primePage(darkPage)
        await darkPage.addInitScript(() => {
          try {
            localStorage.setItem('tahi-theme', 'dark')
          } catch {
            // Storage can be unavailable in some contexts; the check below says so.
          }
          // Record whether the root layout's blocking script ever applied the
          // class, so "no .dark after hydration" cannot pass on a page that
          // simply never read the preference. The observer hangs off the
          // document rather than <html>, which does not exist yet when an init
          // script runs.
          const seen = window as Window & { __tahiDarkSeen?: boolean }
          seen.__tahiDarkSeen = false
          new MutationObserver(() => {
            if (document.documentElement?.classList.contains('dark')) seen.__tahiDarkSeen = true
          }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
        })
        await darkPage.goto(studioLink.signPath)
        await expect(darkPage.getByRole('heading', { name: 'Sam, draw your signature' })).toBeVisible({ timeout: 60_000 })

        // The preference really was dark and reached the page, and the public
        // layout stripped it again.
        expect(await darkPage.evaluate(() => localStorage.getItem('tahi-theme'))).toBe('dark')
        expect(
          await darkPage.evaluate(() => (window as Window & { __tahiDarkSeen?: boolean }).__tahiDarkSeen),
          'the root layout never applied the dark class, so this check proves nothing',
        ).toBe(true)
        await expect
          .poll(() => darkPage.evaluate(() => document.documentElement.classList.contains('dark')), {
            message: 'the dashboard dark class bled into the public contract',
          })
          .toBe(false)

        for (const [label, locator] of [
          ['the agreement body', darkPage.getByText(clause)],
          ['the section title', darkPage.getByRole('heading', { name: 'What you are signing' })],
          ['the signer name', darkPage.getByText(studioSide.name, { exact: true }).first()],
          ['the intent line', darkPage.getByText('and I intend to sign this contract.')],
        ] as const) {
          expect(await contrastOf(locator), `${label} is unreadable in dark mode`).toBeGreaterThanOrEqual(MIN_CONTRAST)
        }
        await expectNoHorizontalScroll(darkPage)
        await expectPadTouchTargets(darkPage)

        await signAs(darkPage, studioSide.name, 'mouse')
        await expect(darkPage.getByRole('heading', { name: 'Fully signed' })).toBeVisible()
        await expect(darkPage.getByText('Contract executed')).toBeVisible()
        await expectNoHorizontalScroll(darkPage)
      } finally {
        await dark.close()
      }

      // ── The signed record ────────────────────────────────────────────────
      await expect.poll(() => contractStatus(studio, id)).toBe('signed')
      const signed = await readContract(studio, id)
      expect(signed.contract.signedAt).not.toBeNull()
      expect(signed.contract.finalHash, 'no final hash anchors the chain').toBeTruthy()
      expect(signed.signers.every(s => s.status === 'signed')).toBe(true)
      expect(signed.signatures).toHaveLength(2)
      for (const signature of signed.signatures) {
        expect(signature.signatureDataUrl.startsWith('data:image/png')).toBe(true)
        expect(signature.bodyHash, 'a signature is not anchored to the body it signed').toBeTruthy()
      }

      // ── The stamped PDF, stored and served ───────────────────────────────
      // Written by the fully-signed fan out after the response went back, so
      // it is polled rather than read once.
      await expect
        .poll(async () => (await readContract(studio, id)).contract.signedStorageKey, {
          message: 'the signed PDF was never written to R2 (on a server with no RESEND_API_KEY at all the fan out '
            + 'returns before the write, lib/contract-fully-signed-emails.ts; run the server with a dead key)',
          timeout: 30_000,
        })
        .toBe(`contracts/${id}/signed.pdf`)
      const adminPdf = await studio.get(`/api/admin/contracts/${id}/signed-pdf`)
      expect(adminPdf.status()).toBe(200)
      expect(adminPdf.headers()['content-type']).toContain('application/pdf')
      expect((await adminPdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')
      const signerPdf = await request.get(`/api/public/contracts/${sent.token}/signed-pdf`)
      expect(signerPdf.status()).toBe(200)
      expect((await signerPdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')

      // ── The studio heard about the final signature too ───────────────────
      await expect
        .poll(() => bellEvents(studio, id), { message: 'the final signature never reached the studio bell' })
        .toContain('contract_signed')
      const [finalRow] = (await bellRowsFor(studio, 'contract', id)).filter(row => row.eventType === 'contract_signed')
      expect(finalRow.title).toBe(`${name} is fully signed`)

      // ── The signed state, as the client sees it afterwards ───────────────
      await page.goto(`/p/contract/${sent.token}`)
      await expect(page.getByText('Every signatory has signed. The contract is fully executed.')).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText('All signatures have been recorded.')).toBeVisible()
      await expectNoHorizontalScroll(page)
      await page.goto(clientLink.signPath)
      await expect(page.getByText(`${client.name}, you have already signed this contract.`)).toBeVisible({ timeout: 60_000 })
      await expect(page.locator('canvas')).toHaveCount(0)
    } finally {
      await markBellRead(studio, 'contract', id)
      await deleteContract(studio, id)
    }
  })

  test('a cancelled contract refuses to open or sign', async ({ page, request, studio }) => {
    test.setTimeout(120_000)
    const tag = runTag()
    const signer: SignerSeed = { role: 'client', name: 'Dana Whitlock', email: `d3-cancelled-${tag}@example.com` }
    const id = await createContract(studio, {
      name: `D3 cancelled ${tag}`,
      clause: `A contract that is cancelled before anyone signs it (${tag}).`,
      signers: [signer],
    })

    try {
      const sent = await sendContract(studio, id)
      const link = signerNamed(sent.signers, signer.name)
      const cancel = await studio.patch(`/api/admin/contracts/${id}`, { data: { status: 'cancelled' } })
      expect(cancel.ok(), 'the cancel was refused').toBeTruthy()

      expect((await request.get(`/api/public/contracts/${sent.token}`)).status()).toBe(410)
      const attempt = await request.post(`/api/public/contracts/${sent.token}/sign/${link.id}`, {
        data: { signatureDataUrl: TINY_SIGNATURE },
      })
      expect(attempt.status(), 'a cancelled contract took a signature').toBe(410)

      await page.goto(link.signPath)
      await expect(page.getByRole('heading', { name: "This contract isn't available" })).toBeVisible({ timeout: 60_000 })
      await expect(page.locator('canvas')).toHaveCount(0)
      await expectNoHorizontalScroll(page)

      const record = await readContract(studio, id)
      expect(record.contract.status).toBe('cancelled')
      expect(record.signatures).toHaveLength(0)
    } finally {
      await deleteContract(studio, id)
    }
  })

  test('a contract past its expiry refuses the signature it lets the signer draw', async ({ page, studio }) => {
    test.setTimeout(120_000)
    const tag = runTag()
    const signer: SignerSeed = { role: 'client', name: 'Dana Whitlock', email: `d3-lapsed-${tag}@example.com` }
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const id = await createContract(studio, {
      name: `D3 lapsed ${tag}`,
      clause: `A contract whose expiry passed before it was signed (${tag}).`,
      signers: [signer],
      expiresAt: yesterday,
    })

    try {
      const sent = await sendContract(studio, id)
      const link = signerNamed(sent.signers, signer.name)

      // The public read does not look at the date (only the sign route does),
      // so the pad still renders. The refusal comes on submit.
      await page.goto(link.signPath)
      await expect(page.getByRole('heading', { name: 'Dana, draw your signature' })).toBeVisible({ timeout: 60_000 })
      await signAs(page, signer.name, 'mouse')
      await expect(page.getByText('This contract has expired.')).toBeVisible()
      await expectNoHorizontalScroll(page)

      const record = await readContract(studio, id)
      expect(record.contract.status, 'the sign route should flip a lapsed contract to expired').toBe('expired')
      expect(record.signatures, 'a lapsed contract kept a signature').toHaveLength(0)
      expect(record.signers.every(s => s.status === 'pending')).toBe(true)

      // Once flipped, the link is closed for good.
      await page.reload()
      await expect(page.getByRole('heading', { name: "This contract isn't available" })).toBeVisible({ timeout: 60_000 })
    } finally {
      await deleteContract(studio, id)
    }
  })
})
