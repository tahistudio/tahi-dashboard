import { clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/server-auth'
import { resolveTeamEntry } from '@/lib/onboarding-entry'
import { TeamWelcomeContent, type TeamHire, type TeamBuddy } from '@/components/tahi/team-welcome-content'

export const metadata = { title: 'Welcome to Tahi' }

/**
 * Teammate "Welcome to Tahi" entry. Reached via a teammate invite link, which
 * carries the new hire's context through sign-in (see lib/onboarding-entry.ts).
 * Contract + payroll are handled off-platform; this is the warm hello only.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { userId } = await getServerAuth()
  if (!userId) {
    const qs = new URLSearchParams(params as Record<string, string>).toString()
    redirect(`/sign-in?redirect_url=${encodeURIComponent('/welcome' + (qs ? '?' + qs : ''))}`)
  }

  const team = resolveTeamEntry(params)

  // Identity: prefer the link, fall back to the signed-in Clerk user. Also skip
  // the welcome if onboarding is already complete. (redirect() is called outside
  // the try so its NEXT_REDIRECT is not swallowed by the catch.)
  let first = team.firstName ?? ''
  let onboardingComplete = false
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    onboardingComplete = !!user.publicMetadata?.onboardingComplete
    if (!first) first = (user.firstName ?? '').trim()
  } catch {
    // non-fatal
  }
  if (onboardingComplete) redirect('/overview')
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

  return <TeamWelcomeContent hire={hire} buddy={buddy} redirectTo="/overview" />
}
