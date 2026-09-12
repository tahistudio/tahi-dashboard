import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import { createPageObjects } from '@clerk/testing/playwright/unstable'
import { adminRequestContext, createTestOrg, mintInvite, testEmail } from './helpers/invites'

/**
 * Cross-org isolation proof (run plan A4).
 *
 * Two real client workspaces, two real Clerk sign-ups, one battery of attempts
 * in each direction. Every id used is a row this spec created a moment earlier,
 * so nothing here can pass by guessing a row that does not exist.
 *
 * THE CONVENTION UNDER TEST. A portal id that belongs to another org answers
 * 404, never 403: "not org-scoped" and "not found" are the same answer, so a
 * client cannot use the status code to learn that somebody else's request,
 * invoice or thread exists. That is the rule pinned by
 * app/api/__tests__/portal-request-projection.test.ts and it is what these
 * assertions hold the live handlers to. The uploads surface is the deliberate
 * exception: /api/uploads/serve and /api/uploads/proxy authorise off a storage
 * key prefix rather than a row, and answer 403, so they are asserted as 403.
 *
 * NOT APPLICABLE YET. There is no portal contracts route. The only contract
 * surfaces are /api/admin/contracts/* (studio) and /api/public/contracts/*
 * (bearer share token). So the contract case is written against the public
 * token route: one org's share token cannot read or sign the other org's
 * contract id or signer id. Portal-authenticated contract isolation becomes
 * testable the day a /api/portal/contracts route exists.
 *
 * SIDE EFFECTS. Seeding creates two client orgs and a handful of rows per org
 * in whatever D1 the harness is pointed at, and it signs up two Clerk test
 * users (+clerk_test@example.com, fixed OTP). It sends no email: the invites
 * are minted without `send`, the contract share route deliberately does not
 * mail signers, and every write attempted across the org boundary is refused
 * before it reaches a notification. The one outbound call worth knowing about
 * is POST /api/admin/calls, which pushes to Google Calendar when the studio
 * Google integration is connected on that harness. Attendees are always empty
 * so nobody is invited, and the spec annotates the run when a calendar event
 * was actually created so the operator can remove it.
 *
 * Runs on one project only (tenancy is not a viewport concern) and serially,
 * because the whole file shares two signed-in sessions. Budget 30 to 45
 * seconds for the two OTP sign-ups. Rerun with --workers=1 if flaky.
 */

const PASSWORD = 'Tahi-e2e-Test-9f3!q'
const hasClerk = !!process.env.CLERK_SECRET_KEY
/** A 1x1 transparent PNG, the smallest thing the sign route accepts. */
const SIGNATURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

interface SeededOrg {
  label: string
  orgId: string
  orgName: string
  email: string
  requestId: string
  filename: string
  storageKey: string
  conversationId: string
  invoiceId: string
  contractId: string
  contractToken: string
  signerId: string
  callId: string
  browser: BrowserContext
  api: APIRequestContext
}

let admin: APIRequestContext | null = null
let orgA: SeededOrg | null = null
let orgB: SeededOrg | null = null

/** Add or replace one query param on a path, leaving any existing ones alone. */
function withQuery(path: string, key: string, value: string): string {
  const url = new URL(path, 'http://harness.invalid')
  url.searchParams.set(key, value)
  return `${url.pathname}${url.search}`
}

/** Every string of this org that must never surface in the other org's payloads. */
function denylistFor(org: SeededOrg): string[] {
  return [
    org.orgId,
    org.orgName,
    org.requestId,
    org.filename,
    org.storageKey,
    org.conversationId,
    org.invoiceId,
    org.contractId,
    org.contractToken,
    org.signerId,
    org.callId,
  ].filter(value => value.length > 0)
}

/**
 * The id-less portal reads. There is no [id] to 404 on, so the proof is that
 * the payload carries none of the other org's known strings. Each must answer
 * 200: a 403 here would make the denylist check pass vacuously, so a denied
 * surface fails the spec rather than quietly weakening it.
 */
const IDLESS_ROUTES = [
  '/api/portal/project',
  '/api/portal/calls',
  '/api/portal/team',
  '/api/portal/tracks',
  '/api/portal/files?limit=100',
  '/api/portal/notifications',
  '/api/portal/announcements',
  '/api/portal/conversations',
  '/api/portal/requests',
  '/api/portal/invoices',
]

/** Seed one org's row set through the admin bypass and return the ids. */
async function seedRows(
  api: APIRequestContext,
  orgId: string,
  label: string,
  runId: number,
): Promise<Omit<SeededOrg, 'label' | 'orgId' | 'orgName' | 'email' | 'browser' | 'api'>> {
  const tag = `${label}-${runId}`

  const requestRes = await api.post('/api/admin/requests', {
    data: {
      clientOrgId: orgId,
      title: `Tenancy proof request ${tag}`,
      type: 'small_task',
      category: 'development',
      description: `Seeded by e2e/tenancy-isolation.spec.ts for org ${tag}.`,
      status: 'submitted',
    },
  })
  expect(requestRes.ok(), `seed request ${tag}: ${await requestRes.text()}`).toBeTruthy()
  const requestId = ((await requestRes.json()) as { id: string }).id

  // File: presign for the real key shape, then confirm for the files row that
  // /api/uploads/serve actually authorises against. When the harness has no R2
  // binding presign answers 503; confirm needs no bucket, so the key is built
  // the way presign would have built it and the row is registered anyway.
  const filename = `tenancy-${tag}-secret.pdf`
  let storageKey = ''
  let fileId = ''
  const presign = await api.post('/api/uploads/presign', {
    data: { filename, mimeType: 'application/pdf', orgId },
  })
  if (presign.ok()) {
    const body = (await presign.json()) as { storageKey?: string; fileId?: string }
    storageKey = body.storageKey ?? ''
    fileId = body.fileId ?? ''
  }
  if (!storageKey) {
    storageKey = `${orgId}/general/${Date.now()}-${filename}`
    fileId = randomUUID()
  }
  const confirm = await api.post('/api/uploads/confirm', {
    data: { fileId, storageKey, filename, mimeType: 'application/pdf', sizeBytes: 1024, orgId },
  })
  expect(confirm.ok(), `seed file ${tag}: ${await confirm.text()}`).toBeTruthy()

  const convRes = await api.post('/api/admin/conversations', {
    data: {
      type: 'group',
      name: `Tenancy proof room ${tag}`,
      orgId,
      visibility: 'external',
    },
  })
  expect(convRes.ok(), `seed conversation ${tag}: ${await convRes.text()}`).toBeTruthy()
  const conversationId = ((await convRes.json()) as { id: string }).id

  // The portal filters drafts out of both the list and the detail route, so the
  // invoice has to be moved off draft to be a real target.
  const invoiceRes = await api.post('/api/admin/invoices', {
    data: {
      orgId,
      currency: 'NZD',
      lineItems: [{ description: `Tenancy proof line ${tag}`, quantity: 1, unitAmount: 100 }],
    },
  })
  expect(invoiceRes.ok(), `seed invoice ${tag}: ${await invoiceRes.text()}`).toBeTruthy()
  const invoiceId = ((await invoiceRes.json()) as { id: string }).id
  const sent = await api.patch(`/api/admin/invoices/${invoiceId}`, { data: { status: 'sent' } })
  expect(sent.ok(), `send invoice ${tag}: ${await sent.text()}`).toBeTruthy()

  const contractRes = await api.post('/api/admin/contracts', {
    data: {
      orgId,
      type: 'nda',
      name: `Tenancy proof contract ${tag}`,
      bodyHtml: `<p>Tenancy proof contract for ${tag}.</p>`,
      signers: [{ role: 'client', name: `Signer ${tag}`, email: `tenancy-${tag}+clerk_test@example.com` }],
    },
  })
  expect(contractRes.ok(), `seed contract ${tag}: ${await contractRes.text()}`).toBeTruthy()
  const contractId = ((await contractRes.json()) as { id: string }).id

  // Mints the public share token and flips draft to sent. This route does not
  // email the signers, by design.
  const shareRes = await api.post(`/api/admin/contracts/${contractId}/send`)
  expect(shareRes.ok(), `share contract ${tag}: ${await shareRes.text()}`).toBeTruthy()
  const share = (await shareRes.json()) as { token: string; signers: Array<{ id: string }> }
  const contractToken = share.token
  const signerId = share.signers[0]?.id ?? ''
  expect(signerId, `contract ${tag} seeded no signer`).not.toBe('')

  // A year out, no attendees, so nothing is ever invited. Google Calendar is
  // pushed only when the studio integration is connected on this harness.
  const scheduledAt = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString()
  const callRes = await api.post('/api/admin/calls', {
    data: {
      orgId,
      title: `Tenancy proof call ${tag}`,
      scheduledAt,
      durationMinutes: 30,
      meetingUrl: 'https://meet.invalid/tenancy-proof',
      attendees: [],
    },
  })
  expect(callRes.ok(), `seed call ${tag}: ${await callRes.text()}`).toBeTruthy()
  const call = (await callRes.json()) as { id: string; calendarPushed?: boolean }
  if (call.calendarPushed) {
    test.info().annotations.push({
      type: 'calendar-event-created',
      description: `Google Calendar event created for "Tenancy proof call ${tag}". Remove it from the studio calendar.`,
    })
  }

  return {
    requestId,
    filename,
    storageKey,
    conversationId,
    invoiceId,
    contractId,
    contractToken,
    signerId,
    callId: call.id,
  }
}

/** Sign up a Clerk test user, accept the org's invite, and return the session. */
async function signInAsClient(
  context: BrowserContext,
  baseURL: string,
  opts: { label: string; email: string; token: string },
): Promise<void> {
  const page = await context.newPage()
  await setupClerkTestingToken({ page })
  const po = createPageObjects({ page, useTestingToken: true, baseURL })

  await page.goto('/sign-up')
  await po.signUp.waitForMounted()
  await po.signUp.signUp({
    email: opts.email,
    password: PASSWORD,
    firstName: 'Tenancy',
    lastName: `Org${opts.label}`,
  })
  await po.signUp.enterTestOtpCode()
  await po.signUp.waitForSession()

  // The invite is consumed explicitly rather than by walking the onboarding UI:
  // this spec is about tenancy, and the onboarding step rail is somebody else's
  // surface to change. Same two calls the onboarding component makes on mount.
  await page.goto('/onboarding')
  await page.waitForFunction(
    () => !!(window as unknown as { Clerk?: unknown }).Clerk,
    undefined,
    { timeout: 30_000 },
  )
  const accepted = await page.evaluate(
    async (inviteToken: string): Promise<{ ok: boolean; error: string | null }> => {
      const res = await fetch('/api/portal/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      })
      const json = (await res.json()) as { clerkOrgId?: string; error?: string }
      if (!res.ok || !json.clerkOrgId) return { ok: false, error: json.error ?? `status ${res.status}` }
      const clerk = (window as unknown as {
        Clerk?: { setActive?: (opts: { organization: string }) => Promise<void> }
      }).Clerk
      if (!clerk?.setActive) return { ok: false, error: 'Clerk.setActive was not available' }
      await clerk.setActive({ organization: json.clerkOrgId })
      return { ok: true, error: null }
    },
    opts.token,
  )
  expect(accepted.ok, `accept-invite for org ${opts.label}: ${accepted.error}`).toBeTruthy()

  // The page stays open on purpose. Clerk refreshes the short-lived session
  // cookie from the browser, and context.request shares that cookie jar, so a
  // battery of API calls that outlives one token still authenticates.
  await page.goto('/overview')
  await expect
    .poll(async () => (await context.request.get('/api/portal/project')).status(), {
      timeout: 30_000,
      message: `org ${opts.label} session never became org-scoped`,
    })
    .toBe(200)
}

/**
 * The messages the studio can see on a request thread right now, serialised so
 * two reads compare exactly. Read through the admin surface on purpose: a write
 * that was refused has to be proved absent from the store, not from the
 * response of the request that tried it.
 */
async function threadMessages(api: APIRequestContext, requestId: string): Promise<string> {
  const res = await api.get(`/api/admin/messages/request/${requestId}`)
  expect(res.ok(), `admin read of thread ${requestId}: ${res.status()}`).toBeTruthy()
  const json = (await res.json()) as { messages?: unknown[] }
  return JSON.stringify(json.messages ?? [])
}

test.describe('Cross-org isolation (A4)', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!hasClerk, 'Clerk keys not configured; set CLERK_SECRET_KEY to run.')

  // Playwright requires the fixtures argument to be an object pattern, and this
  // hook needs none of them.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Tenancy is not a viewport concern; one project is enough.',
    )
  })

  test.beforeAll(async ({ browser }, testInfo) => {
    if (testInfo.project.name !== 'chromium') return
    if (!hasClerk) return
    test.setTimeout(240_000)

    const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3000'
    const runId = Date.now()
    admin = await adminRequestContext(baseURL)

    const build = async (label: string): Promise<SeededOrg> => {
      const orgName = `Tenancy Proof ${label} ${runId}`
      const email = testEmail(`tenancy-${label.toLowerCase()}`, runId)
      const orgId = await createTestOrg(orgName, baseURL)
      const { token } = await mintInvite(
        { orgId, flow: 'client', persona: 'project', contactEmail: email, contactName: `Tenancy Org${label}` },
        baseURL,
      )
      const rows = await seedRows(admin as APIRequestContext, orgId, label, runId)
      const context = await browser.newContext({ baseURL })
      await signInAsClient(context, baseURL, { label, email, token })
      return { label, orgId, orgName, email, browser: context, api: context.request, ...rows }
    }

    orgA = await build('A')
    orgB = await build('B')
  })

  test.afterAll(async () => {
    await orgA?.browser.close()
    await orgB?.browser.close()
    await admin?.dispose()
    orgA = null
    orgB = null
    admin = null
  })

  /**
   * Everything one org can aim at the other, in one direction. Called twice so
   * neither side is proved only in the direction that happens to be safe.
   */
  async function runBattery(attacker: SeededOrg, victim: SeededOrg): Promise<void> {
    const studio = admin as APIRequestContext
    const api = attacker.api
    const from = `org ${attacker.label} -> org ${victim.label}`
    const deny = denylistFor(victim)
    const neverIssued = randomUUID()

    await test.step(`${from}: the request and its sub-resources are 404, never 403`, async () => {
      const get = await api.get(`/api/portal/requests/${victim.requestId}`)
      expect(get.status(), `${from} GET request detail`).toBe(404)

      const patch = await api.patch(`/api/portal/requests/${victim.requestId}`, {
        data: { status: 'delivered' },
      })
      expect(patch.status(), `${from} PATCH request (approve)`).toBe(404)

      const review = await api.post(`/api/portal/requests/${victim.requestId}/review`, {
        data: { decision: 'approve', note: `tenancy probe ${attacker.label}` },
      })
      expect(review.status(), `${from} POST review`).toBe(404)

      const reads = await api.post(`/api/portal/requests/${victim.requestId}/reads`, { data: {} })
      expect(reads.status(), `${from} POST reads`).toBe(404)

      const steps = await api.post(`/api/portal/requests/${victim.requestId}/steps`, {
        data: { title: `tenancy probe ${attacker.label}` },
      })
      expect(steps.status(), `${from} POST steps`).toBe(404)

      const subs = await api.get(`/api/portal/requests/${victim.requestId}/sub-requests`)
      expect(subs.status(), `${from} GET sub-requests`).toBe(404)

      const files = await api.get(`/api/portal/requests/${victim.requestId}/files`)
      expect(files.status(), `${from} GET request files`).toBe(404)

      // sub-requests and files expose no POST handler, so Next answers 405.
      // The invariant is the same either way: never 200, never 403.
      for (const leaf of ['sub-requests', 'files']) {
        const res = await api.post(`/api/portal/requests/${victim.requestId}/${leaf}`, { data: {} })
        expect([404, 405], `${from} POST ${leaf}`).toContain(res.status())
      }
    })

    await test.step(`${from}: the message thread is 404 and writes nothing`, async () => {
      const before = await threadMessages(studio, victim.requestId)
      const marker = `tenancy-leak-${attacker.label}-${Date.now()}`

      const read = await api.get(`/api/portal/messages/request/${victim.requestId}`)
      expect(read.status(), `${from} GET thread`).toBe(404)

      const write = await api.post(`/api/portal/messages/request/${victim.requestId}`, {
        data: { body: `<p>${marker}</p>` },
      })
      expect(write.status(), `${from} POST thread`).toBe(404)

      const after = await threadMessages(studio, victim.requestId)
      expect(after, `${from} POST thread inserted a row`).not.toContain(marker)
      expect(after, `${from} POST thread changed the victim thread`).toBe(before)

      // The channel source resolves the room from the authenticated org and
      // ignores the id in the path, so it answers with the attacker's own room.
      const channel = await api.get(`/api/portal/messages/channel/${victim.conversationId}`)
      expect(channel.status(), `${from} GET channel by foreign id`).toBe(200)
      const channelText = await channel.text()
      for (const needle of deny) {
        expect(channelText, `${from} channel read leaked "${needle}"`).not.toContain(needle)
      }
    })

    await test.step(`${from}: stored files are 403 on the key, by row and by guess`, async () => {
      const real = await api.get(withQuery('/api/uploads/serve', 'key', victim.storageKey))
      expect(real.status(), `${from} serve a real foreign key`).toBe(403)

      // A legacy-shaped key with no files row behind it: the prefix fallback
      // has to refuse it too.
      const guessed = `${victim.orgId}/general/${Date.now()}-file.pdf`
      const guess = await api.get(withQuery('/api/uploads/serve', 'key', guessed))
      expect(guess.status(), `${from} serve a guessed foreign key`).toBe(403)

      const proxy = await api.fetch(withQuery('/api/uploads/proxy', 'key', guessed), {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        data: 'tenancy probe',
      })
      expect(proxy.status(), `${from} PUT into a foreign key prefix`).toBe(403)
    })

    await test.step(`${from}: the invoice is 404 and absent from the list`, async () => {
      const detail = await api.get(`/api/portal/invoices/${victim.invoiceId}`)
      expect(detail.status(), `${from} GET invoice detail`).toBe(404)

      const list = await api.get('/api/portal/invoices')
      expect(list.status(), `${from} GET invoice list`).toBe(200)
      expect(await list.text(), `${from} invoice list carried the other org's invoice`).not.toContain(
        victim.invoiceId,
      )
    })

    await test.step(`${from}: the id-less reads carry none of the other org's strings`, async () => {
      for (const route of IDLESS_ROUTES) {
        const res = await api.get(route)
        expect(res.status(), `${from} GET ${route}`).toBe(200)
        const text = await res.text()
        for (const needle of deny) {
          expect(text, `${from} ${route} leaked "${needle}"`).not.toContain(needle)
        }
      }
    })

    await test.step(`${from}: a share token opens its own contract and nothing else`, async () => {
      const own = await api.get(`/api/public/contracts/${attacker.contractToken}`)
      expect(own.status(), `${from} GET own share token`).toBe(200)
      const ownText = await own.text()
      expect(ownText, `${from} own share token exposed the other contract`).not.toContain(
        victim.contractId,
      )
      expect(ownText, `${from} own share token exposed the other signer`).not.toContain(
        victim.signerId,
      )

      // The other org's contract id is not a share token, however UUID shaped.
      const byId = await api.get(`/api/public/contracts/${victim.contractId}`)
      expect(byId.status(), `${from} GET the other contract by id`).toBe(404)

      // Signing is bound to the contract the token opened, so the other org's
      // signer id is refused rather than counted.
      const sign = await api.post(
        `/api/public/contracts/${attacker.contractToken}/sign/${victim.signerId}`,
        { data: { signatureDataUrl: SIGNATURE_DATA_URL } },
      )
      expect(sign.status(), `${from} sign with a foreign signer id`).toBe(404)

      const signUnknown = await api.post(
        `/api/public/contracts/${attacker.contractToken}/sign/${neverIssued}`,
        { data: { signatureDataUrl: SIGNATURE_DATA_URL } },
      )
      expect(signUnknown.status(), `${from} sign with a never issued signer id`).toBe(404)
    })

    await test.step(`${from}: a never issued id answers 404, never 500`, async () => {
      const notFound: Array<[string, number]> = [
        [`/api/portal/requests/${neverIssued}`, (await api.get(`/api/portal/requests/${neverIssued}`)).status()],
        [`/api/portal/requests/${neverIssued}/files`, (await api.get(`/api/portal/requests/${neverIssued}/files`)).status()],
        [`/api/portal/requests/${neverIssued}/sub-requests`, (await api.get(`/api/portal/requests/${neverIssued}/sub-requests`)).status()],
        [`/api/portal/invoices/${neverIssued}`, (await api.get(`/api/portal/invoices/${neverIssued}`)).status()],
        [`/api/portal/messages/request/${neverIssued}`, (await api.get(`/api/portal/messages/request/${neverIssued}`)).status()],
        [`/api/public/contracts/${neverIssued}`, (await api.get(`/api/public/contracts/${neverIssued}`)).status()],
      ]
      for (const [route, status] of notFound) {
        expect(status, `${from} GET ${route} with a never issued id`).toBe(404)
      }

      // The uploads surface authorises off a key prefix, so an unknown key is a
      // refusal rather than a miss. Still never a 500.
      const serve = await api.get(withQuery('/api/uploads/serve', 'key', neverIssued))
      expect(serve.status(), `${from} serve a never issued key`).toBe(403)
    })

    await test.step(`${from}: a trailing slash is the same answer`, async () => {
      for (const route of [
        `/api/portal/requests/${victim.requestId}/`,
        `/api/portal/invoices/${victim.invoiceId}/`,
        `/api/portal/messages/request/${victim.requestId}/`,
      ]) {
        const res = await api.get(route)
        expect(res.status(), `${from} GET ${route}`).toBe(404)
      }
    })

    await test.step(`${from}: naming the other org in a query or a body changes nothing`, async () => {
      // The ?orgId= branch in app/api/portal/messages/_shared.ts is gated on the
      // MCP service token (userId 'api-service'). A real browser session must
      // never reach it, in either the query or the body.
      const namedRead = await api.get(
        withQuery(`/api/portal/messages/request/${victim.requestId}`, 'orgId', victim.orgId),
      )
      expect(namedRead.status(), `${from} GET thread with ?orgId=`).toBe(404)

      const before = await threadMessages(studio, victim.requestId)
      const marker = `tenancy-inject-${attacker.label}-${Date.now()}`
      const namedWrite = await api.post(`/api/portal/messages/request/${victim.requestId}`, {
        data: { body: `<p>${marker}</p>`, orgId: victim.orgId },
      })
      expect(namedWrite.status(), `${from} POST thread with body orgId`).toBe(404)
      const after = await threadMessages(studio, victim.requestId)
      expect(after, `${from} body orgId inserted a row`).not.toContain(marker)
      expect(after, `${from} body orgId changed the victim thread`).toBe(before)

      // The same injection on the request sub-resources.
      const reads = await api.post(`/api/portal/requests/${victim.requestId}/reads`, {
        data: { orgId: victim.orgId },
      })
      expect(reads.status(), `${from} POST reads with body orgId`).toBe(404)
      const steps = await api.post(`/api/portal/requests/${victim.requestId}/steps`, {
        data: { title: `tenancy probe ${attacker.label}`, orgId: victim.orgId },
      })
      expect(steps.status(), `${from} POST steps with body orgId`).toBe(404)
      const review = await api.post(`/api/portal/requests/${victim.requestId}/review`, {
        data: { decision: 'approve', orgId: victim.orgId },
      })
      expect(review.status(), `${from} POST review with body orgId`).toBe(404)

      // And on every id-less read, where ?orgId= is the only lever there is.
      for (const route of IDLESS_ROUTES) {
        const named = withQuery(route, 'orgId', victim.orgId)
        const res = await api.get(named)
        expect(res.status(), `${from} GET ${named}`).toBe(200)
        const text = await res.text()
        for (const needle of deny) {
          expect(text, `${from} ${named} leaked "${needle}"`).not.toContain(needle)
        }
      }
    })
  }

  test('org A reaches nothing of org B', async () => {
    test.setTimeout(180_000)
    await runBattery(orgA as SeededOrg, orgB as SeededOrg)
  })

  test('org B reaches nothing of org A', async () => {
    test.setTimeout(180_000)
    await runBattery(orgB as SeededOrg, orgA as SeededOrg)
  })

  test('each org still reaches its own rows', async () => {
    test.setTimeout(120_000)
    // The other half of the proof. Without it every assertion above could pass
    // on a portal that simply 404s everything.
    for (const org of [orgA as SeededOrg, orgB as SeededOrg]) {
      const detail = await org.api.get(`/api/portal/requests/${org.requestId}`)
      expect(detail.status(), `org ${org.label} cannot open its own request`).toBe(200)
      expect(await detail.text(), `org ${org.label} request detail is not its own`).toContain(
        org.requestId,
      )

      const invoice = await org.api.get(`/api/portal/invoices/${org.invoiceId}`)
      expect(invoice.status(), `org ${org.label} cannot open its own invoice`).toBe(200)

      const thread = await org.api.get(`/api/portal/messages/request/${org.requestId}`)
      expect(thread.status(), `org ${org.label} cannot open its own thread`).toBe(200)

      const files = await org.api.get('/api/portal/files?limit=100')
      expect(files.status(), `org ${org.label} cannot list its own files`).toBe(200)
      expect(await files.text(), `org ${org.label} file list is missing its own file`).toContain(
        org.filename,
      )
    }
  })
})
