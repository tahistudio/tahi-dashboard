/**
 * lib/org-onboarding-server.ts - the D1 + Clerk wiring for lib/org-onboarding.ts.
 *
 * Resolves whether a signed-in CLIENT's organisation already counts as
 * onboarded and, when it does, stamps the caller's own Clerk
 * publicMetadata.onboardingComplete so the cheap per-user flag also passes on
 * their next request. See lib/org-onboarding.ts for the pure decision this
 * wraps, and the bug (a colleague invited into an already-onboarded org
 * landing on the client onboarding wizard) it exists to close.
 *
 * Called from app/(dashboard)/layout.tsx and app/(onboarding)/onboarding/page.tsx
 * ONLY, mirroring lib/contact-link-server.ts and lib/team-link-server.ts: a
 * page load is the one place we know a signed-in human is actually looking at
 * the product, and the MCP service token must never touch this.
 *
 * Fails closed throughout: any D1 or Clerk hiccup answers "not onboarded",
 * which only ever sends someone through the (safe) onboarding flow one more
 * time. It can never lock a real client out of their own portal, because both
 * callers check the cheap per-user flag FIRST and only reach this on a miss.
 */

import { clerkClient } from '@clerk/nextjs/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import {
  isOrgOnboarded,
  parseOnboardingState,
  LIVE_SUBSCRIPTION_STATUSES,
} from '@/lib/org-onboarding'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Resolve whether `clerkOrgId`'s D1 organisation is onboarded and, if so,
 * stamp the caller's own publicMetadata to match.
 *
 * @param userId     Clerk user id from the session.
 * @param clerkOrgId The session's ACTIVE Clerk organisation id (NOT the D1 id).
 */
export async function resolveAndStampOrgOnboarding(
  userId: string | null,
  clerkOrgId: string | null,
): Promise<boolean> {
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!userId || !clerkOrgId) return false
  if (tahiOrgId && clerkOrgId === tahiOrgId) return false

  try {
    const database = (await db()) as unknown as Drizzle
    const [org] = await database
      .select({
        id: schema.organisations.id,
        onboardingState: schema.organisations.onboardingState,
      })
      .from(schema.organisations)
      .where(eq(schema.organisations.clerkOrgId, clerkOrgId))
      .limit(1)
    if (!org) return false

    let hasLiveSubscription = false
    try {
      const [sub] = await database
        .select({ status: schema.subscriptions.status })
        .from(schema.subscriptions)
        .where(and(
          eq(schema.subscriptions.orgId, org.id),
          inArray(schema.subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        ))
        .limit(1)
      hasLiveSubscription = !!sub
    } catch {
      hasLiveSubscription = false
    }

    let hasProjectEngagement = false
    try {
      const [proj] = await database
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.orgId, org.id))
        .limit(1)
      hasProjectEngagement = !!proj
    } catch {
      hasProjectEngagement = false
    }

    const onboarded = isOrgOnboarded({
      onboardingState: parseOnboardingState(org.onboardingState),
      hasLiveSubscription,
      hasProjectEngagement,
    })
    if (!onboarded) return false

    // Best-effort mirror onto the user's own flag so the cheap check short-
    // circuits next time. A failure here does not change the answer for THIS
    // request: the org already qualifies, so we return true regardless.
    try {
      const clerk = await clerkClient()
      const user = await clerk.users.getUser(userId)
      if (!user.publicMetadata?.onboardingComplete) {
        await clerk.users.updateUser(userId, {
          publicMetadata: { ...user.publicMetadata, onboardingComplete: true },
        })
      }
    } catch {
      // non-fatal
    }

    return true
  } catch {
    return false
  }
}
