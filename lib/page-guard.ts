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
 */

import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { resolvePermissions, can, type ResolvedAccess } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

async function resolve(): Promise<ResolvedAccess | null> {
  try {
    const { userId, orgId } = await getServerAuth()
    if (!userId) redirect('/sign-in')
    const drizzle = (await db()) as unknown as D1
    return await resolvePermissions(drizzle, { userId, orgId })
  } catch {
    return null // fail-open
  }
}

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
