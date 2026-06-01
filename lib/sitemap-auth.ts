/**
 * Sitemap access gate.
 *
 * /sitemap is currently a private planning surface for Liam + Staci
 * only. Hardcoded email allowlist — no UI to manage, no DB row. When
 * the broader access model (granular permissions) lands, this whole
 * file gets replaced with a `sitemap.view` permission check.
 *
 * Returns 404 to non-allowlist users — the route doesn't even hint
 * at existing for anyone outside the allowlist.
 */

import { clerkClient } from '@clerk/nextjs/server'
import type { NextRequest } from 'next/server'
import { getRequestAuth, getServerAuth } from '@/lib/server-auth'

const ALLOWLIST = new Set([
  'business@tahi.studio',
  'staci@tahi.studio',
])

/** True if the userId resolves to an email on the sitemap allowlist. */
export async function hasSitemapAccess(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  try {
    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    const email = user.primaryEmailAddress?.emailAddress?.toLowerCase()
    if (!email) return false
    return ALLOWLIST.has(email)
  } catch {
    return false
  }
}

/** For API routes — returns the userId when allowed, null when blocked.
 *  The 'api-service' userId comes from TAHI_API_TOKEN auth (MCP, cron, etc.)
 *  and is trusted by definition: anyone holding the token already controls
 *  the whole dashboard, so gating by email would just block legitimate MCP. */
export async function assertSitemapApiAccess(req: NextRequest): Promise<string | null> {
  const { userId } = await getRequestAuth(req)
  if (!userId) return null
  if (userId === 'api-service') return userId
  const allowed = await hasSitemapAccess(userId)
  return allowed ? userId : null
}

/** For server components — same shape but reads from next/headers. */
export async function assertSitemapPageAccess(): Promise<string | null> {
  const { userId } = await getServerAuth()
  if (!userId) return null
  const allowed = await hasSitemapAccess(userId)
  return allowed ? userId : null
}
