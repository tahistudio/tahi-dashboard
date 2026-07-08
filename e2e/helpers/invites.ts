import { request as playwrightRequest, type APIRequestContext } from '@playwright/test'

/**
 * Admin API helpers for the onboarding-persona e2e tests.
 *
 * Auth: in `next dev` (NODE_ENV !== production) the middleware + server-auth
 * "Ship Studio" bypass treats a request carrying the `tahi-ship-studio=1` cookie
 * as the Tahi admin. We use that to mint test orgs + invites without a real admin
 * sign-in. (This bypass is dead-code-eliminated from the production build.)
 */

const BASE = 'http://localhost:3000'

async function adminContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { 'x-ship-studio': '1' },
    // The server-auth bypass also accepts the cookie; set both for belt + braces.
    storageState: {
      cookies: [
        { name: 'tahi-ship-studio', value: '1', domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
      ],
      origins: [],
    },
  })
}

/** Create a fresh client org and return its D1 id. */
export async function createTestOrg(name: string): Promise<string> {
  const ctx = await adminContext()
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
export async function mintInvite(opts: MintOpts): Promise<{ token: string; path: string }> {
  const ctx = await adminContext()
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
