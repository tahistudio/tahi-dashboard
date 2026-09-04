/**
 * lib/page-guard.ts — granular-permissions guards for server-component pages.
 *
 * Sidebar hiding is cosmetic; these guards are the real gate — a team member who
 * types a denied URL is redirected. Use in a page.tsx server component:
 *
 *   await requirePageFeature('financial_reports')   // redirects if denied
 *   await requirePageManage()                        // permissions builder
 *
 * Fail-open on resolver error (never lock a user out of the whole app over a
 * permissions hiccup); the explicit deny path is the only thing that redirects.
 *
 * Client pages are gated too: `resolvePermissions` normalises the Clerk org id
 * `getServerAuth` returns to the D1 `organisations.id` that feature_visibility
 * rows are keyed on, so a client org denied a feature is hidden in the nav,
 * redirected off the page AND 403'd on the portal API. Visible equals permitted
 * on all three surfaces, never two of the three.
 */

import { cache } from 'react'
import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { resolvePermissions, can, holdsNoGrant, type ResolvedAccess } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Resolve the caller's access, memoized per request with React `cache()` so a
 * page that calls two guards (or a guard plus another server-side consumer in
 * the same render) pays for ONE resolution instead of one each.
 *
 * The auth read and its redirect sit OUTSIDE the fail-open catch on purpose:
 * `redirect()` signals by throwing NEXT_REDIRECT, so a catch-all around it would
 * swallow the bounce and hand an anonymous caller a rendered page. Only the D1
 * read fails open.
 */
const resolve = cache(async (): Promise<ResolvedAccess | null> => {
  let userId: string | null = null
  let orgId: string | null = null
  try {
    const auth = await getServerAuth()
    userId = auth.userId
    orgId = auth.orgId
  } catch {
    return null // auth backend hiccup: fail open, the page's own gate still runs
  }
  if (!userId) redirect('/sign-in')

  try {
    const drizzle = (await db()) as unknown as D1
    return await resolvePermissions(drizzle, { userId, orgId })
  } catch {
    return null // fail-open on a permissions read error
  }
})

/** Redirect to /overview unless the caller can see `featureKey`. */
export async function requirePageFeature(featureKey: string): Promise<void> {
  const access = await resolve()
  if (access && !can(access, featureKey)) redirect('/overview')
}

/** Redirect unless the caller can manage permissions (admin+). */
export async function requirePageManage(): Promise<void> {
  const access = await resolve()
  if (access && !access.canManagePermissions) redirect('/overview')
}

/**
 * Redirect a caller who holds NO permission grant at all (a Tahi-org identity
 * with no active role). Use on team pages that have no FEATURE_TREE key of
 * their own, so "roleless means denied everywhere" holds there too rather than
 * leaving an ungated page as the one thing a roleless hire can still open.
 *
 * Admins, super-admins and clients all pass (their grant is unrestricted); use
 * `requirePageFeature` when the page maps to a real feature key.
 */
export async function requirePageAnyGrant(): Promise<void> {
  const access = await resolve()
  if (access && holdsNoGrant(access)) redirect('/overview')
}
