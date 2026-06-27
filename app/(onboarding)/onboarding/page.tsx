import { clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/server-auth'
import { resolveClientEntry } from '@/lib/onboarding-entry'
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
  const { userId } = await getServerAuth()
  if (!userId) {
    const qs = new URLSearchParams(params as Record<string, string>).toString()
    redirect(`/sign-in?redirect_url=${encodeURIComponent('/onboarding' + (qs ? '?' + qs : ''))}`)
  }

  const entry = resolveClientEntry(params)

  // Fetch the Clerk user once: skip onboarding if already completed, and
  // prefill identity when the link did not carry it. (redirect() is called
  // outside the try so its NEXT_REDIRECT is not swallowed by the catch.)
  let onboardingComplete = false
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    onboardingComplete = !!user.publicMetadata?.onboardingComplete
    entry.contactName = entry.contactName ?? (`${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || undefined)
    entry.contactEmail = entry.contactEmail ?? user.emailAddresses[0]?.emailAddress
  } catch {
    // non-fatal: render onboarding without prefill
  }
  if (onboardingComplete) redirect('/overview')

  // SEAM: the studio lead is the assigned PM for this client; default to Liam.
  const lead: OnboardingLead = { name: 'Liam Miller', first: 'Liam', role: 'Your studio lead', initials: 'LM', img: '/liam-profile.jpg' }

  return <OnboardingContent entry={entry} lead={lead} redirectTo="/overview" />
}
