import { clerkClient } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getViewAudience } from '@/lib/view-audience'
import { resolveClientEntry, clientEntryFromPersona, type ClientPersona } from '@/lib/onboarding-entry'
import { resolveInvite, isSeatInvite, acceptClientInvite } from '@/lib/onboarding-invites'
import { resolveAndStampOrgOnboarding } from '@/lib/org-onboarding-server'
import { loadStudioLead } from '@/lib/onboarding-lead-server'
import { db } from '@/lib/db'
import { OnboardingContent, type OnboardingLead } from '@/components/tahi/onboarding-content'
import { FeedbackBall } from '@/components/tahi/feedback-ball'
import { AuthShell } from '@/components/tahi/auth-shell'

export const metadata = { title: 'Welcome to Tahi' }

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Plain landing for a seat invite that could not be accepted: the wrong
 * account, or a token that is already spent or expired. Never the wizard -
 * this person is not a first contact, so there is nothing to onboard them
 * into.
 */
function InviteProblem({ headline, message }: { headline: string; message: string }) {
  return (
    <AuthShell
      centeredScene
      pill="Your workspace"
      headline={headline}
      footerPrompt="Wrong account?"
      footerLinkLabel="Sign in with a different one"
      footerLinkHref="/sign-in"
    >
      <div className="w-full text-center">
        <p className="text-[0.9375rem] leading-[1.6] text-[var(--color-text)]">{message}</p>
        <p className="mt-[0.75rem] text-[0.8125rem] leading-[1.5] text-[var(--color-text-muted)]">
          Ask the studio for a new invite if you still need access.
        </p>
      </div>
    </AuthShell>
  )
}

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
  // getViewAudience() also answers whether this is a Tahi session previewing
  // the portal as one client (Client view): the kickoff step's booking POST
  // refuses that session by design, so the picker needs to know up front
  // rather than let every slot fail with a generic error (see
  // components/tahi/onboarding-content.tsx).
  const { userId, orgId, isPreviewingClient } = await getViewAudience()
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
  // The org this person is being onboarded into, for the studio-lead lookup
  // below. An invite names the D1 org directly; otherwise the session's Clerk
  // org is resolved to the same row (loadStudioLead accepts either shape).
  let leadOrgRef: string | null = orgId ?? null
  // Set inside the try below, acted on AFTER it: redirect() throws a special
  // Next.js control-flow error that a surrounding catch would otherwise
  // swallow silently (see the redirect() calls elsewhere in this file, all
  // outside their own try blocks, for the same reason).
  let seatAccepted = false
  let seatProblem: { headline: string; message: string } | null = null
  if (token) {
    try {
      const database = (await db()) as D1
      const invite = await resolveInvite(database, token)
      if (invite?.orgId) leadOrgRef = invite.orgId

      if (invite && invite.flow === 'client' && invite.orgId) {
        // Seat vs first contact, decided from the ORG'S OWN roster
        // (lib/onboarding-invites.ts isSeatInvite), never invite.persona or
        // invite.flow. A seat invite (this org already has someone else on
        // it - the admin who sent it, an earlier teammate) is accepted
        // immediately, right here, server-side: no chooser, no plan, no pay
        // step, ever. A first-contact invite (a brand-new org, nobody on it
        // yet) falls through to today's wizard below.
        const seat = await isSeatInvite(database, invite.orgId, invite.contactEmail)
        if (seat) {
          const result = await acceptClientInvite(database, userId, invite)
          if (result.ok) {
            seatAccepted = true
          } else if (result.status === 403) {
            seatProblem = {
              headline: 'This invite needs a different account.',
              message: `This invite was sent to ${invite.contactEmail ?? 'a different address'}. Sign in with that email address to accept it.`,
            }
          } else {
            seatProblem = { headline: 'This invite is no longer valid.', message: result.error }
          }
        }
      }

      if (!seatAccepted && !seatProblem && invite && invite.flow === 'client' && invite.persona && !invite.expired) {
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

  // The invited org becomes the session's active organisation via
  // /continue's own setActive dance (lib/workspace-choice.ts): this fresh
  // seat holds exactly one Clerk membership (the one just granted), so it
  // activates on its own with no picker shown.
  if (seatAccepted) redirect('/continue')
  if (seatProblem) {
    return <InviteProblem headline={seatProblem.headline} message={seatProblem.message} />
  }

  // Prefill from the signed-in user where the link did not carry identity.
  entry.contactName = entry.contactName ?? viewerName
  entry.contactEmail = entry.contactEmail ?? viewerEmail

  // Org-level onboarding backfill (see lib/org-onboarding.ts). A colleague
  // invited straight into an already-onboarded org via a plain Clerk
  // organization invitation never ran this route's own completion call
  // themselves, so onboardingComplete above reads false even though their
  // organisation finished onboarding long ago. Treat them as complete too,
  // and stamp their own publicMetadata so the cheap check also passes next
  // time. Only checked once the cheap per-user flag has already missed.
  if (!onboardingComplete && orgId) {
    onboardingComplete = await resolveAndStampOrgOnboarding(userId, orgId)
  }

  // Only skip onboarding when they are genuinely ready (complete AND in an org).
  // Gating on orgId too prevents the /overview <-> /onboarding redirect loop a
  // complete-but-org-less session would otherwise hit.
  if (onboardingComplete && orgId) redirect('/overview')

  // The studio lead is the org's assigned project_manager (the same assignment
  // the client detail page shows), falling back to the first super_admin and
  // then to the literal this line used to hardcode. See lib/onboarding-lead.ts.
  const lead: OnboardingLead = await loadStudioLead(leadOrgRef)

  return (
    <>
      <OnboardingContent
        entry={entry}
        lead={lead}
        redirectTo="/overview"
        inviteToken={inviteToken}
        isPreviewingClient={isPreviewingClient}
      />
      <FeedbackBall />
    </>
  )
}
