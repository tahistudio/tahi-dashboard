import { clerkClient } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/server-auth'
import { resolveClientEntry, clientEntryFromPersona, type ClientPersona } from '@/lib/onboarding-entry'
import { resolveInvite } from '@/lib/onboarding-invites'
import { db } from '@/lib/db'
import { OnboardingContent, type OnboardingLead } from '@/components/tahi/onboarding-content'

export const metadata = { title: 'Welcome to Tahi' }

/**
 * Client onboarding entry. The link decides the experience (self-serve chooser,
 * invited care path, existing-client new engagement); see lib/onboarding-entry.ts.
 * The link context passes through sign-in via redirect_url so it survives auth.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { userId, orgId } = await getServerAuth()
  if (!userId) {
    const qs = new URLSearchParams(params as Record<string, string>).toString()
    redirect(`/sign-in?redirect_url=${encodeURIComponent('/onboarding' + (qs ? '?' + qs : ''))}`)
  }

  // An invite token (server-trusted) wins over any query-param persona. The
  // token may no longer be on the URL after the Clerk auth round-trip, so fall
  // back to the cookie the middleware stashed from the original link.
  const tokenParam = params.token
  let token = typeof tokenParam === 'string' ? tokenParam : Array.isArray(tokenParam) ? tokenParam[0] : undefined
  if (!token) {
    const jar = await cookies()
    token = jar.get('tahi-invite-token')?.value || undefined
  }

  // Fetch the Clerk user once: skip onboarding if already completed, prefill
  // identity, and learn the caller's verified email (used to gate invite PII).
  // (redirect() is called outside the try so its NEXT_REDIRECT survives.)
  let onboardingComplete = false
  let viewerEmail: string | undefined
  let viewerEmailVerified = false
  let viewerName: string | undefined
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    onboardingComplete = !!user.publicMetadata?.onboardingComplete
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)
    viewerEmail = primary?.emailAddress
    viewerEmailVerified = primary?.verification?.status === 'verified'
    viewerName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || undefined
  } catch {
    // non-fatal: render onboarding without prefill
  }

  let entry = resolveClientEntry(params)
  let inviteToken: string | undefined
  if (token) {
    try {
      const database = await db()
      const invite = await resolveInvite(
        database as ReturnType<typeof import('drizzle-orm/d1').drizzle>,
        token,
      )
      if (invite && invite.flow === 'client' && invite.persona && !invite.expired) {
        // Only disclose the invitee's PII (company / name / email) when the
        // signed-in user's VERIFIED email matches the invite. A token holder on
        // a different account still gets the right persona/flow, but never the
        // invitee's details (accept-invite separately enforces the same binding).
        const matches =
          viewerEmailVerified &&
          !!invite.contactEmail &&
          (viewerEmail ?? '').toLowerCase() === invite.contactEmail.toLowerCase()
        entry = clientEntryFromPersona(invite.persona as ClientPersona, {
          companyName: matches ? invite.companyName ?? undefined : undefined,
          contactName: matches ? invite.contactName ?? undefined : undefined,
          contactEmail: matches ? invite.contactEmail ?? undefined : undefined,
        })
        inviteToken = token
      }
    } catch {
      // fall back to the query-param entry
    }
  }

  // Prefill from the signed-in user where the link did not carry identity.
  entry.contactName = entry.contactName ?? viewerName
  entry.contactEmail = entry.contactEmail ?? viewerEmail
  // Only skip onboarding when they are genuinely ready (complete AND in an org).
  // Gating on orgId too prevents the /overview <-> /onboarding redirect loop a
  // complete-but-org-less session would otherwise hit.
  if (onboardingComplete && orgId) redirect('/overview')

  // SEAM: the studio lead is the assigned PM for this client; default to Liam.
  const lead: OnboardingLead = { name: 'Liam Miller', first: 'Liam', role: 'Your studio lead', initials: 'LM', img: '/liam-profile.jpg' }

  return <OnboardingContent entry={entry} lead={lead} redirectTo="/overview" inviteToken={inviteToken} />
}
