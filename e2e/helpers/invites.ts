import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Admin API helpers for the onboarding-persona e2e tests.
 *
 * Auth: in `next dev` (NODE_ENV !== production) the middleware + server-auth
 * "Ship Studio" bypass treats a request carrying the `tahi-ship-studio=1` cookie
 * as the Tahi admin. We use that to mint test orgs + invites without a real admin
 * sign-in. (This bypass is dead-code-eliminated from the production build.)
 */

const DEFAULT_BASE = 'http://localhost:3000'

/**
 * Which harness a call is pointed at.
 *
 * `PLAYWRIGHT_TEST_BASE_URL` is set by Playwright itself ONLY from the
 * webServer plugin (playwright/lib/plugins/webServerPlugin.js writes it from
 * `webServer.url`), which is what the default `playwright.config.ts` uses. A
 * config that instead sets `use.baseURL` by hand, like the 3179 QA harness,
 * leaves the variable unset, so those callers pass the `baseURL` fixture in
 * explicitly. Without one of the two, seeding silently lands in the D1 behind
 * port 3000 while the assertions read the one behind 3179.
 */
function resolveBase(baseURL?: string): string {
  return baseURL ?? process.env.PLAYWRIGHT_TEST_BASE_URL ?? DEFAULT_BASE
}

/**
 * A request context authenticated as the Tahi admin through the dev-only
 * Ship Studio bypass. Exported so a spec can seed its own fixtures (requests,
 * files, invoices) through the same door the invite helpers use.
 *
 * The caller owns the returned context and must dispose it.
 */
export async function adminRequestContext(baseURL?: string): Promise<APIRequestContext> {
  const base = resolveBase(baseURL)
  const host = new URL(base).hostname
  return playwrightRequest.newContext({
    baseURL: base,
    extraHTTPHeaders: { 'x-ship-studio': '1' },
    // The server-auth bypass also accepts the cookie; set both for belt + braces.
    storageState: {
      cookies: [
        { name: 'tahi-ship-studio', value: '1', domain: host, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
      ],
      origins: [],
    },
  })
}

/** Create a fresh client org and return its D1 id. */
export async function createTestOrg(name: string, baseURL?: string): Promise<string> {
  const ctx = await adminRequestContext(baseURL)
  try {
    const res = await ctx.post('/api/admin/clients', { data: { name, customMrr: 0 } })
    if (!res.ok()) throw new Error(`createTestOrg failed: ${res.status()} ${await res.text()}`)
    const json = (await res.json()) as { id?: string; client?: { id?: string } }
    const id = json.id ?? json.client?.id
    if (!id) throw new Error('createTestOrg: no id in response')
    return id
  } finally {
    await ctx.dispose()
  }
}

interface MintOpts {
  orgId?: string
  flow: 'client' | 'team'
  persona?: 'project' | 'existing_project' | 'retainer' | 'existing_retainer'
  contactEmail: string
  contactName?: string
}

/** Mint an onboarding invite link and return its token + path. */
export async function mintInvite(opts: MintOpts, baseURL?: string): Promise<{ token: string; path: string }> {
  const ctx = await adminRequestContext(baseURL)
  try {
    const res = await ctx.post('/api/admin/onboarding-invites', { data: opts })
    if (!res.ok()) throw new Error(`mintInvite failed: ${res.status()} ${await res.text()}`)
    const json = (await res.json()) as { token: string; path: string }
    return json
  } finally {
    await ctx.dispose()
  }
}

/** A unique Clerk test email (code 424242) so each run signs up a fresh user. */
export function testEmail(tag: string, runId: number): string {
  return `tahi-e2e-${tag}-${runId}+clerk_test@example.com`
}

/**
 * Navigate to `url` right after a Clerk sign-up completes.
 *
 * The very first hard navigation after `waitForSession()` sometimes races an
 * in-flight background fetch from the page being left (observed: a Next.js
 * RSC request still pending against the previous route). Chromium reports
 * that unrelated abort as if the new navigation itself had failed with
 * net::ERR_ABORTED, even though the server answers normally a moment later
 * and the destination page goes on to render. Waiting for the navigation to
 * commit (rather than the full load event) plus one retry absorbs that race;
 * any other error is a real failure and is rethrown as is.
 */
export async function gotoAfterSignUp(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'commit' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('ERR_ABORTED')) throw err
    await page.waitForTimeout(250)
    await page.goto(url, { waitUntil: 'commit' })
  }
}
