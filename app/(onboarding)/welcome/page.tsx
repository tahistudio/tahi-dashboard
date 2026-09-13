import { clerkClient } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/server-auth'
import { resolveTeamEntry } from '@/lib/onboarding-entry'
import { resolveInvite } from '@/lib/onboarding-invites'
import { db } from '@/lib/db'
import { TeamWelcomeContent, type TeamHire, type TeamBuddy } from '@/components/tahi/team-welcome-content'

export const metadata = { title: 'Welcome to Tahi' }

/**
 * Teammate "Welcome to Tahi" entry. Reached via a teammate invite link
 * (app/api/admin/team/[id]/invite mints it), which carries the new hire's
 * context through sign-in (see lib/onboarding-entry.ts) and, since this invite
 * is now an app token rather than a Clerk organization invitation, ALSO grants
 * the Tahi org membership itself: see the `inviteToken` prop below, consumed
 * client side by TeamWelcomeContent against
 * app/api/admin/team/accept-invite/route.ts. Contract + payroll are handled
 * off-platform; this is the warm hello only.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { userId, orgId } = await getServerAuth()
  if (!userId) {
    const qs = new URLSearchParams(params as Record<string, string>).toString()
    redirect(`/sign-in?redirect_url=${encodeURIComponent('/welcome' + (qs ? '?' + qs : ''))}`)
  }

  const team = resolveTeamEntry(params)

  // The invite token, from the link or (after the Clerk auth round-trip may
  // have dropped the query string) the cookie middleware stashed it in. See
  // app/(onboarding)/onboarding/page.tsx for the client-flow twin of this.
  const tokenParam = params.token
  let token = typeof tokenParam === 'string' ? tokenParam : Array.isArray(tokenParam) ? tokenParam[0] : undefined
  if (!token) {
    const jar = await cookies()
    token = jar.get('tahi-invite-token')?.value || undefined
  }

  // Identity: prefer the link, fall back to the signed-in Clerk user. Also skip
  // the welcome if onboarding is already complete. (redirect() is called outside
  // the try so its NEXT_REDIRECT is not swallowed by the catch.)
  let first = team.firstName ?? ''
  let onboardingComplete = false
  let viewerEmail: string | undefined
  let viewerEmailVerified = false
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    onboardingComplete = !!user.publicMetadata?.onboardingComplete
    if (!first) first = (user.firstName ?? '').trim()
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)
    viewerEmail = primary?.emailAddress
    viewerEmailVerified = primary?.verification?.status === 'verified'
  } catch {
    // non-fatal
  }
  // Complete AND in an org before skipping ahead (avoids the redirect loop).
  if (onboardingComplete && orgId) redirect('/overview')

  // Resolve the invite server side (server-trusted), only to prefill the name
  // and to decide whether it is safe to hand the token to the client for
  // acceptance. The accept route re-validates the email binding itself; this
  // is a courtesy, not the security boundary.
  let inviteToken: string | undefined
  if (token) {
    try {
      const database = await db()
      const invite = await resolveInvite(
        database as ReturnType<typeof import('drizzle-orm/d1').drizzle>,
        token,
      )
      if (invite && invite.flow === 'team' && !invite.expired) {
        const matches =
          viewerEmailVerified &&
          !!invite.contactEmail &&
          (viewerEmail ?? '').toLowerCase() === invite.contactEmail.toLowerCase()
        if (matches && !first && invite.contactName) first = invite.contactName.split(' ')[0]
        inviteToken = token
      }
    } catch {
      // fall back to no invite context
    }
  }

  first = first || 'there'
  const initials = first.slice(0, 2).toUpperCase()

  // SEAM: role / start date / gear / buddy come from the teammate invite record.
  // Defaults render a complete, on-brand welcome until that lookup is wired.
  const hire: TeamHire = {
    first,
    initials,
    role: 'New teammate',
    start: 'your first day',
    startShort: 'day one',
    gear: 'MacBook Pro 16',
  }
  const buddy: TeamBuddy = { first: 'Liam', name: 'Liam Miller', initials: 'LM', img: '/liam-profile.jpg' }

  return <TeamWelcomeContent hire={hire} buddy={buddy} redirectTo="/overview" inviteToken={inviteToken} />
}
