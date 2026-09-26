import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import {
  bellRowsFor,
  expectFitsPhone,
  markBellRead,
  PHONE_CONTEXT,
  primePage,
  skipUnlessMailIsDead,
  testWithStudio as test,
} from './helpers'

/**
 * RUN REQUIREMENT: E2E_DEAD_RESEND_KEY=1, against a dev server started with
 * RESEND_API_KEY set to a dead value. Without the flag every test in this
 * file skips. Each signature mails the studio's admins, and the final one
 * mails the signed PDF to every signer and to the contract's creator, who is
 * Liam's dev user on a tahi.studio address the email allowlist lets through.
 * Against a server reading the live key from .env.local, a run lands in a
 * real inbox. The runner cannot see the server's key, so the flag is the
 * operator's word for it (skipUnlessMailIsDead in e2e/helpers.ts); the
 * commands are in docs/local-dev-and-qa.md.
 *
 * D3, the contract half: send, sign on a phone, signed PDF, studio notified.
 *
 * The reviewer's blocker on C2 was that nothing drove the public contract
 * viewer in a browser. This does, on a 375px phone context (isMobile and
 * hasTouch, see PHONE_CONTEXT), against the live handlers:
 *
 *   - A contract with two signers is created and sent through the admin
 *     routes. The send route mints the share token and hands back one sign
 *     path per signer; it mails nobody (see its own header).
 *   - The client signer opens their link and draws a signature with a finger
 *     on the real canvas, ticks the intent box and submits. The pad has to
 *     take the stroke as touch pointer events without the browser cancelling
 *     it to scroll the page (its touch-action), which a mouse stroke never
 *     tests. The page flips to "Your signature is in" and the studio bell
 *     gets a partial row.
 *   - The studio signer opens theirs on a second phone whose dashboard theme
 *     is dark (localStorage tahi-theme=dark before the first paint, which is
 *     what the root layout's blocking script reads), and signs with a mouse
 *     pointer, so the pad's mouse path is covered too. The blocking script
 *     skips /p/ paths (lib/theme-boot-script.ts), so the contract must never
 *     carry `.dark`, not even for a first frame, and its text has to stay
 *     readable. The same phone opens /offline first, a public page outside
 *     /p/, and has to paint dark there, so "never dark" cannot pass on a
 *     phone that simply never read the preference. They sign; the page reads
 *     Fully signed.
 *   - The document is signed with a final hash, both signatures carry a body
 *     hash and are more than a blank pad's export, and each stored signature
 *     is the export its own signer's pad submitted. The two signers draw
 *     different strokes, so the two stored images differ and the PDF can be
 *     held to carrying both rather than one of them twice. The stamped PDF is
 *     in R2 at contracts/<id>/signed.pdf, written by the fully-signed fan out
 *     before anyone downloads it, naming both signers and drawing two
 *     different signature images, and served by both the admin and the
 *     token-scoped download routes. The bell has the final row.
 *
 * Then the two refusals. A cancelled contract 410s every read and write and
 * the link says it is no longer active. A contract past its expiry is refused
 * on the read, before any document or pad goes out: the link shows the
 * expired state and no canvas ever renders, and a signature posted straight
 * to the sign route is refused with a 410, which is also what flips the row to
 * expired. Nothing is recorded, and the signer stays pending.
 *
 * The signed PDF and the dead key. The final signature starts the fully-signed
 * fan out (lib/contract-fully-signed-emails.ts), which renders the PDF and
 * writes it to R2 and signedStorageKey before it decides whether to mail
 * anyone, so the key is written on any server, with a key, a dead key or none.
 * The dead key is there for the mail alone: Resend refuses every send, on top
 * of the allowlist, which already holds back every address but
 * business@tahi.studio (every signer here is on example.com).
 *
 * Data: every contract is created here under a unique name and deleted in a
 * finally, and its signers and signatures go with it through the ON DELETE
 * CASCADE the migrations declare (the seeded QA sqlite lost those clauses, see
 * e2e/sales-publish.spec.ts). The stamped PDF stays in the local R2 bucket,
 * which has no delete route; the bell rows are marked read.
 *
 * One project only: the whole file runs on the 375px phone context.
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

/** What a signer's pad held at submit: a blank pad's export length and the export sent. */
interface PadExport {
  blankLength: number
  submitted: string
}

/** A 1x1 transparent PNG, the smallest thing the sign route accepts. */
const TINY_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** WCAG AA for body text. */
const MIN_CONTRAST = 4.5

/** The expired state's deadline sentence; the date is in the reader's locale. */
const DEADLINE_LAPSED = /Its signing deadline was .+, so it can no longer be signed from this link\./

/**
 * A phone for every page in the file: the client signer's finger needs the
 * touch screen, and the 375px checks need a mobile layout viewport rather
 * than a narrow desktop window. Mouse input still works on the same context,
 * which is how the studio signer below covers the pad's mouse path.
 */
test.use({ ...PHONE_CONTEXT })

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The whole file runs on a 375px phone context; a second project would only repeat the same fixtures.',
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
 * A stroke as waypoints in fractions of the pad's box, 0 to 1 across and down,
 * so it lands the same way on any pad size.
 */
type Stroke = readonly Point[]

/**
 * The client's stroke: three legs, so a finger sends 3 * STROKE_STEPS moves
 * (the 24 watchPad's note counts).
 */
const CLIENT_STROKE: Stroke = [
  { x: 0.15, y: 0.45 },
  { x: 0.35, y: 0.25 },
  { x: 0.55, y: 0.6 },
  { x: 0.8, y: 0.35 },
]

/**
 * The studio's stroke, a W with four legs. It has to differ from the client's:
 * the same waypoints ink the same pixels, both pads export the same PNG, and
 * jsPDF stores identical images once and draws that one twice, so the PDF
 * check could not tell two signatures from one signer's in both slots.
 */
const STUDIO_STROKE: Stroke = [
  { x: 0.1, y: 0.35 },
  { x: 0.3, y: 0.75 },
  { x: 0.5, y: 0.4 },
  { x: 0.7, y: 0.75 },
  { x: 0.9, y: 0.3 },
]

/**
 * Draw a signature on the pad with a real pointer, a mouse or a finger.
 *
 * The pad sits in a FadeSection that lifts 0.625rem into place as it scrolls
 * into view, so the stroke waits for that to settle: a box read mid-lift would
 * put the pointer a few pixels off the canvas the handlers measure against.
 */
async function drawSignature(page: Page, via: 'mouse' | 'touch', stroke: Stroke): Promise<void> {
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
  const waypoints: Point[] = stroke.map(point => ({
    x: box.x + box.width * point.x,
    y: box.y + box.height * point.y,
  }))

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

/**
 * The length of a blank pad's PNG export: a fresh canvas the size of the pad's
 * backing store, exported the way the pad submits (toDataURL 'image/png'). A
 * stored signature no longer than this carries no ink, whatever the pad showed
 * on screen.
 */
async function blankPadExportLength(page: Page): Promise<number> {
  return page.locator('canvas').evaluate((el) => {
    const pad = el as HTMLCanvasElement
    const blank = document.createElement('canvas')
    blank.width = pad.width
    blank.height = pad.height
    return blank.toDataURL('image/png').length
  })
}

/** Both pad buttons at or over the 44px touch floor. */
async function expectPadTouchTargets(page: Page): Promise<void> {
  for (const name of ['Clear', 'Sign and submit']) {
    const box = await page.getByRole('button', { name }).boundingBox()
    expect(box?.height ?? 0, `${name} is under the 44px touch floor`).toBeGreaterThanOrEqual(44)
  }
}

/**
 * Draw, tick the intent box and submit. Returns the blank export length for
 * this pad, so the caller can hold the stored signature to more than that,
 * and the pad's own export at submit (the same toDataURL call the pad makes),
 * so the caller can hold each stored signature to the one its signer drew.
 */
async function signAs(page: Page, signerName: string, via: 'mouse' | 'touch', stroke: Stroke): Promise<PadExport> {
  if (via === 'touch') await watchPad(page)
  await drawSignature(page, via, stroke)
  if (via === 'touch') {
    const heard = await padPointers(page)
    expect(heard.touchDowns, 'the finger never reached the pad as a touch pointer').toBeGreaterThan(0)
    expect(heard.touchMoves, 'the pad heard almost none of the finger stroke').toBeGreaterThan(STROKE_STEPS)
    expect(heard.cancels, 'the browser cancelled the stroke to scroll the page').toBe(0)
  }
  expect(await inkedPixels(page), 'the stroke left no ink on the pad').toBeGreaterThan(50)
  const blankLength = await blankPadExportLength(page)
  const submitted = await page.locator('canvas').evaluate(el => (el as HTMLCanvasElement).toDataURL('image/png'))
  await page.getByRole('checkbox', { name: new RegExp(`I am ${signerName}`) }).check()
  await page.getByRole('button', { name: 'Sign and submit' }).click()
  return { blankLength, submitted }
}

/**
 * Record, from before the first byte of the page parses, whether a canvas was
 * ever in the document, so "no pad" covers the loading frames as well as the
 * settled page. The observer hangs off the document for the reason the dark
 * mode watcher's does.
 */
async function watchForPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = window as Window & { __padSeen?: boolean }
    seen.__padSeen = false
    new MutationObserver(() => {
      if (document.querySelector('canvas')) seen.__padSeen = true
    }).observe(document, { subtree: true, childList: true })
  })
}

async function padWasSeen(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => (window as Window & { __padSeen?: boolean }).__padSeen)
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
      // The pad watcher runs here too, as the control for the refusal tests
      // below: it has to see a pad that is really there.
      await watchForPad(page)
      await page.goto(clientLink.signPath)
      await expect(page.getByRole('heading', { name: 'Dana, draw your signature' })).toBeVisible({ timeout: 60_000 })
      expect(await padWasSeen(page), 'the pad watcher missed a pad that is on screen').toBe(true)
      await expect(page.getByText(clause)).toBeVisible()
      await expectFitsPhone(page)
      await expectPadTouchTargets(page)

      const padExports: Record<string, PadExport> = {}
      padExports[clientLink.id] = await signAs(page, client.name, 'touch', CLIENT_STROKE)
      await expect(page.getByRole('heading', { name: 'Your signature is in' })).toBeVisible()
      await expect(page.getByText('1 of 2 signed so far.')).toBeVisible()
      await expectFitsPhone(page)

      await expect.poll(() => contractStatus(studio, id)).toBe('partially_signed')
      await expect
        .poll(() => bellEvents(studio, id), { message: 'the partial signature never reached the studio bell' })
        .toContain('contract_partially_signed')

      // ── The studio signs with a mouse, dashboard theme dark ──────────────
      const dark = await browser.newContext({ ...PHONE_CONTEXT, baseURL })
      try {
        const darkPage = await dark.newPage()
        await primePage(darkPage)
        await darkPage.addInitScript(() => {
          try {
            localStorage.setItem('tahi-theme', 'dark')
          } catch {
            // Storage can be unavailable in some contexts; the control below says so.
          }
          // Record, per document, whether `.dark` was ever on <html>, from
          // before the first byte parses: the class the root layout's
          // blocking script adds is gone again after hydration on a page
          // that strips it, so only a watcher this early sees a dark first
          // frame. The observer hangs off the document rather than <html>,
          // which does not exist yet when an init script runs.
          const seen = window as Window & { __tahiDarkSeen?: boolean }
          seen.__tahiDarkSeen = false
          new MutationObserver(() => {
            if (document.documentElement?.classList.contains('dark')) seen.__tahiDarkSeen = true
          }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
        })
        const darkWasSeen = () =>
          darkPage.evaluate(() => (window as Window & { __tahiDarkSeen?: boolean }).__tahiDarkSeen)

        // The control: outside /p/ this phone's stored preference paints the
        // page dark, so the watcher and the preference both work.
        await darkPage.goto('/offline')
        await expect
          .poll(darkWasSeen, { message: 'the root layout never applied the dark class on /offline, so the check below proves nothing' })
          .toBe(true)

        await darkPage.goto(studioLink.signPath)
        await expect(darkPage.getByRole('heading', { name: 'Sam, draw your signature' })).toBeVisible({ timeout: 60_000 })
        expect(await darkPage.evaluate(() => localStorage.getItem('tahi-theme'))).toBe('dark')
        expect(await darkWasSeen(), 'the dashboard dark class reached the public contract, if only for a frame').toBe(false)
        expect(await darkPage.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)

        for (const [label, locator] of [
          ['the agreement body', darkPage.getByText(clause)],
          ['the section title', darkPage.getByRole('heading', { name: 'What you are signing' })],
          ['the signer name', darkPage.getByText(studioSide.name, { exact: true }).first()],
          ['the intent line', darkPage.getByText('and I intend to sign this contract.')],
        ] as const) {
          expect(
            await contrastOf(locator),
            `${label} is unreadable under a dark preference; the public contract has to stay light`,
          ).toBeGreaterThanOrEqual(MIN_CONTRAST)
        }
        await expectFitsPhone(darkPage)
        await expectPadTouchTargets(darkPage)

        padExports[studioLink.id] = await signAs(darkPage, studioSide.name, 'mouse', STUDIO_STROKE)
        await expect(darkPage.getByRole('heading', { name: 'Fully signed' })).toBeVisible()
        await expect(darkPage.getByText('Contract executed')).toBeVisible()
        await expectFitsPhone(darkPage)
        expect(await darkWasSeen(), 'the signed state brought the dashboard dark class back').toBe(false)
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
        const pad = padExports[signature.signerId]
        if (!pad) throw new Error(`no pad export was captured for signer ${signature.signerId}`)
        expect(pad.blankLength, `no blank export was measured for signer ${signature.signerId}`).toBeGreaterThan(0)
        expect(signature.signatureDataUrl.length, 'a stored signature is no bigger than a blank pad\'s export')
          .toBeGreaterThan(pad.blankLength)
        expect(
          signature.signatureDataUrl === pad.submitted,
          `the signature stored for signer ${signature.signerId} is not the one their pad submitted`,
        ).toBe(true)
      }
      expect(
        new Set(signed.signatures.map(s => s.signatureDataUrl)).size,
        'both signers stored the same image, so the PDF cannot show whether it carries one signature or two',
      ).toBe(2)

      // ── The stamped PDF, stored by the fan out and served ────────────────
      // The fan out runs after the signer's response went back, so the key is
      // polled rather than read once. Nothing has downloaded the PDF yet, and
      // the download routes are the only other writer of this key (they
      // backfill it on a rebuild, lib/contract-signed-artifact.ts), so the
      // key appearing here is the fan out's own write. It persists before any
      // send decision, so the dead key has no say in it.
      await expect
        .poll(async () => (await readContract(studio, id)).contract.signedStorageKey, {
          message: 'the fully-signed fan out never wrote the signed PDF to R2 (lib/contract-fully-signed-emails.ts)',
          timeout: 30_000,
        })
        .toBe(`contracts/${id}/signed.pdf`)
      const adminPdf = await studio.get(`/api/admin/contracts/${id}/signed-pdf`)
      expect(adminPdf.status()).toBe(200)
      expect(adminPdf.headers()['content-type']).toContain('application/pdf')
      const stamped = (await adminPdf.body()).toString('latin1')
      expect(stamped.startsWith('%PDF-')).toBe(true)
      // jsPDF writes its text uncompressed, so the stamp is readable here.
      for (const signerName of [client.name, studioSide.name]) {
        expect(stamped, `the stamped PDF does not name ${signerName}`).toContain(signerName)
      }
      expect(stamped, 'the stamped PDF still lists a signer as awaiting').not.toContain('Awaiting signature')
      // Counting `/Subtype /Image` proves nothing here. A pad export is an
      // alpha PNG, which jsPDF stores as two image objects (the colour and an
      // SMask for the alpha), so one signature alone counts two. jsPDF also
      // stores identical images once, so one signer's image in both slots is
      // one image drawn twice. What does tell: one SMask per distinct
      // signature, and two different image XObjects drawn (`/I0 Do`, `/I1 Do`
      // in the page stream, which jsPDF leaves uncompressed). With the two
      // stored signatures different (asserted above), that is both of them.
      expect(
        stamped.match(/\/SMask \d+ 0 R/g)?.length ?? 0,
        'the stamped PDF does not store two distinct signature images',
      ).toBeGreaterThanOrEqual(2)
      const drawnImages = Array.from(stamped.matchAll(/\/(I\d+) Do/g), match => match[1])
      expect(drawnImages.length, 'the stamped PDF does not draw a signature in both slots').toBeGreaterThanOrEqual(2)
      expect(
        new Set(drawnImages).size,
        'the stamped PDF draws the same signature image in both slots',
      ).toBeGreaterThanOrEqual(2)
      const signerPdf = await request.get(`/api/public/contracts/${sent.token}/signed-pdf`)
      expect(signerPdf.status()).toBe(200)
      expect((await signerPdf.body()).toString('latin1'), 'the signer download is not the stored PDF').toBe(stamped)
      expect(
        (await readContract(studio, id)).contract.signedStorageKey,
        'a download moved the stored key',
      ).toBe(`contracts/${id}/signed.pdf`)

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
      await expectFitsPhone(page)
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

      const read = await request.get(`/api/public/contracts/${sent.token}`)
      expect(read.status()).toBe(410)
      expect(await read.json()).toMatchObject({ reason: 'cancelled' })
      const attempt = await request.post(`/api/public/contracts/${sent.token}/sign/${link.id}`, {
        data: { signatureDataUrl: TINY_SIGNATURE },
      })
      expect(attempt.status(), 'a cancelled contract took a signature').toBe(410)

      await watchForPad(page)
      await page.goto(link.signPath)
      await expect(page.getByRole('heading', { name: 'This contract is no longer active' })).toBeVisible({ timeout: 60_000 })
      await expect(page.locator('canvas')).toHaveCount(0)
      expect(await padWasSeen(page), 'a signature pad rendered on a cancelled contract').toBe(false)
      await expectFitsPhone(page)

      const record = await readContract(studio, id)
      expect(record.contract.status).toBe('cancelled')
      expect(record.signatures).toHaveLength(0)
    } finally {
      await deleteContract(studio, id)
    }
  })

  test('a contract past its expiry shows the expired state before any pad, and the sign route refuses it', async ({ page, request, studio }) => {
    test.setTimeout(120_000)
    const tag = runTag()
    const clause = `A contract whose expiry passed before it was signed (${tag}).`
    const signer: SignerSeed = { role: 'client', name: 'Dana Whitlock', email: `d3-lapsed-${tag}@example.com` }
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const id = await createContract(studio, {
      name: `D3 lapsed ${tag}`,
      clause,
      signers: [signer],
      expiresAt: yesterday,
    })

    try {
      const sent = await sendContract(studio, id)
      const link = signerNamed(sent.signers, signer.name)

      // The read refuses once the deadline has passed, before any document
      // goes out, and says why. It does not write: the row still reads
      // 'sent', so the studio can extend the expiry and revive the link.
      const read = await request.get(`/api/public/contracts/${sent.token}`)
      expect(read.status(), 'the read served a contract past its signing deadline').toBe(410)
      const refusal = await read.json() as { reason?: string; expiresAt?: string | null; contract?: unknown }
      expect(refusal.reason).toBe('expired')
      expect(refusal.expiresAt).toBe(yesterday)
      expect(refusal.contract, 'the refusal carried the document anyway').toBeUndefined()
      expect(await contractStatus(studio, id), 'the read wrote to the row').toBe('sent')

      // The signer's link: the expired state, and no pad at any point, the
      // loading frames included.
      await watchForPad(page)
      await page.goto(link.signPath)
      await expect(page.getByRole('heading', { name: 'This contract has expired' })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText(DEADLINE_LAPSED)).toBeVisible()
      await expect(page.locator('canvas')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Sign and submit' })).toHaveCount(0)
      await expect(page.getByText(clause)).toHaveCount(0)
      expect(await padWasSeen(page), 'a signature pad rendered before the expired state').toBe(false)
      await expectFitsPhone(page)

      // The page offering no pad is a courtesy; the sign route is the
      // guarantee. A signature posted straight to it is refused, and that
      // attempt is what writes 'expired' onto the row.
      const attempt = await request.post(`/api/public/contracts/${sent.token}/sign/${link.id}`, {
        data: { signatureDataUrl: TINY_SIGNATURE },
      })
      expect(attempt.status(), 'a lapsed contract took a signature').toBe(410)
      expect(await attempt.json()).toMatchObject({ error: 'This contract has expired.' })

      const record = await readContract(studio, id)
      expect(record.contract.status, 'the sign route should flip a lapsed contract to expired').toBe('expired')
      expect(record.contract.signedAt, 'a lapsed contract was dated as signed').toBeNull()
      expect(record.signatures, 'a lapsed contract kept a signature').toHaveLength(0)
      expect(record.signers, 'the lapsed contract lost its signer').toHaveLength(1)
      expect(record.signers.every(s => s.status === 'pending'), 'a signer on a lapsed contract is no longer pending').toBe(true)

      // Once flipped, the route still refuses, and the link still reads as
      // expired against the deadline that lapsed.
      const again = await request.post(`/api/public/contracts/${sent.token}/sign/${link.id}`, {
        data: { signatureDataUrl: TINY_SIGNATURE },
      })
      expect(again.status(), 'an expired contract took a signature').toBe(410)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'This contract has expired' })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText(DEADLINE_LAPSED)).toBeVisible()
      expect(await padWasSeen(page), 'a signature pad rendered on an expired contract').toBe(false)
      await expectFitsPhone(page)
      expect((await readContract(studio, id)).signatures).toHaveLength(0)
    } finally {
      await deleteContract(studio, id)
    }
  })
})
