import { getPortalAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { getStripe } from '@/lib/stripe-plans'

export const dynamic = 'force-dynamic'

const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due'])

/**
 * POST /api/onboarding/complete
 * Mark the current user's onboarding as done (Clerk publicMetadata flag), so the
 * /onboarding and /welcome entry pages skip straight to /overview next time.
 *
 * SECURITY: this flag is what the dashboard layout gates client access on, so it
 * must NOT be a self-grantable bypass. We set it only once the caller is genuinely
 * ENTITLED to the portal:
 *   - a teammate / Tahi admin (in the Tahi org), OR
 *   - a client who consumed an admin-minted invite (the no-payment personas:
 *     invited project / existing client), OR
 *   - a client whose org holds an active/trialing/past_due subscription (a
 *     self-serve retainer who actually paid).
 * A self-serve visitor who only provisioned a free org and never paid is NOT
 * entitled, so the flag stays unset and the layout keeps them in onboarding.
 */
export async function POST(req: NextRequest) {
  const { userId, orgId, clerkOrgId } = await getPortalAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // A user with no org has not finished provisioning / joining. Marking them
  // complete would make onboarding redirect to /overview, which the middleware
  // bounces back (no org) - an infinite loop. Refuse until they have one.
  if (!orgId) return NextResponse.json({ ok: false, reason: 'no-org' })

  // Teammates / admins live in the Tahi org and are entitled by definition.
  const isTeammate = clerkOrgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  let entitled = isTeammate
  if (!entitled) {
    const database = await db()

    // (a) Consumed invite for this user + org => admin-granted, no payment needed.
    try {
      const [inv] = await database
        .select({ id: schema.onboardingInvites.id })
        .from(schema.onboardingInvites)
        .where(and(eq(schema.onboardingInvites.orgId, orgId), eq(schema.onboardingInvites.usedByUserId, userId)))
        .limit(1)
      if (inv) entitled = true
    } catch {
      // non-fatal: fall through to the subscription checks
    }

    // (b) Active subscription on record.
    let stripeSubId: string | null = null
    if (!entitled) {
      try {
        const [sub] = await database
          .select({ status: schema.subscriptions.status, stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.orgId, orgId))
          .limit(1)
        if (sub && ACTIVE_SUB_STATUSES.has(sub.status)) entitled = true
        else stripeSubId = sub?.stripeSubscriptionId ?? null
      } catch {
        // non-fatal
      }
    }

    // (c) Webhook-lag fallback: the PaymentElement may have just succeeded while
    // our row is still 'incomplete' (the customer.subscription.updated webhook
    // not yet processed). Ask Stripe directly so a genuine payer is never bounced.
    if (!entitled && stripeSubId) {
      try {
        const stripe = getStripe()
        if (stripe) {
          const s = await stripe.subscriptions.retrieve(stripeSubId)
          if (s && ACTIVE_SUB_STATUSES.has(s.status)) {
            entitled = true
            // Opportunistically sync our row so the next read is fast + correct.
            await database
              .update(schema.subscriptions)
              .set({ status: s.status, updatedAt: new Date().toISOString() })
              .where(eq(schema.subscriptions.orgId, orgId))
          }
        }
      } catch {
        // non-fatal: treat as not-yet-entitled
      }
    }
  }

  if (!entitled) {
    // Not paid and not invited: do not unlock the dashboard.
    return NextResponse.json({ ok: false, reason: 'not-entitled' }, { status: 402 })
  }

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
