import { getRequestAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboarding/complete
 * Mark the current user's onboarding as done (Clerk publicMetadata flag), so the
 * /onboarding and /welcome entry pages skip straight to /overview next time.
 * Audience-agnostic: works for clients and teammates regardless of org state.
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only mark complete once the user belongs to an org. A user with no org has
  // not finished provisioning / joining; marking them complete would make the
  // onboarding page redirect to /overview, which the middleware bounces back to
  // /onboarding (no org) - an infinite loop. Refuse until they have one.
  if (!orgId) return NextResponse.json({ ok: false, reason: 'no-org' })

  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    await clerk.users.updateUser(userId, {
      publicMetadata: { ...user.publicMetadata, onboardingComplete: true },
    })
  } catch {
    // Non-fatal: the flow still routes onward; the guard just won't skip next time.
    return NextResponse.json({ ok: false })
  }
  return NextResponse.json({ ok: true })
}
