import { cookies } from 'next/headers'
import { clerkClient } from '@clerk/nextjs/server'
import { ClerkSignIn, ClerkSignUp } from '@/components/tahi/clerk-mount'
import { AuthShell } from '@/components/tahi/auth-shell'
import { tahiClerkAppearance, TAHI_TRUST_AVATARS } from '@/lib/auth-shell-config'
import { db } from '@/lib/db'
import { resolveInvite } from '@/lib/onboarding-invites'

export const metadata = {
  title: 'Create your workspace - Tahi Studio',
  description: 'Get started with Tahi Studio.',
}

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * /sign-up. A seat invite (middleware.ts's shouldLandOnSignUp) lands its
 * signed-out visitor here rather than /sign-in, because Clerk's sign-in
 * screen has nothing to authenticate against for an address with no account
 * yet. This page reads the SAME token (query, falling back to the cookie the
 * middleware set on the way in) and:
 *
 *   - prefills the invite's bound email into whichever widget renders
 *     (Clerk `initialValues.emailAddress`), and
 *   - shows a one-line trust cue naming the org, and
 *   - looks the email up server-side (clerkClient users.getUserList): an
 *     address that ALREADY has a Clerk account renders SignIn instead of
 *     SignUp, since that account should sign in, not create a second one.
 *
 * Best-effort throughout: a garbage token or a D1 hiccup falls back to the
 * plain sign-up form exactly as before this existed. A Clerk account-lookup
 * hiccup degrades one step less far: the invite itself still resolved, so its
 * email is still worth prefilling, only `hasAccount` defaults to false
 * (sign-up mode) rather than guessing sign-in.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const tokenParam = params.token
  let token = typeof tokenParam === 'string' ? tokenParam : Array.isArray(tokenParam) ? tokenParam[0] : undefined
  if (!token) {
    const jar = await cookies()
    token = jar.get('tahi-invite-token')?.value || undefined
  }

  let inviteEmail: string | undefined
  let companyName: string | undefined
  let hasAccount = false
  if (token) {
    try {
      const database = (await db()) as D1
      const invite = await resolveInvite(database, token)
      if (invite && invite.flow === 'client' && !invite.expired && invite.contactEmail) {
        inviteEmail = invite.contactEmail
        companyName = invite.companyName ?? undefined
        const clerk = await clerkClient()
        const { data } = await clerk.users.getUserList({ emailAddress: [inviteEmail] })
        hasAccount = data.length > 0
      }
    } catch {
      // fall back to a plain sign-up, no prefill
    }
  }

  const trustCue = inviteEmail
    ? `You are accepting an invite${companyName ? ` to ${companyName}` : ''}.`
    : undefined
  const initialValues = inviteEmail ? { emailAddress: inviteEmail } : undefined

  return (
    <AuthShell
      pill="Your workspace"
      headline={hasAccount ? 'Welcome back.' : 'Your project, start to finish, in one place.'}
      sub={
        hasAccount
          ? 'Sign in to accept your invite.'
          : 'From the first brief to the final invoice, you can always see where things stand.'
      }
      testimonial={{
        quote: "Tahi have been brilliant to work with. Friendly, fast, and always delivering high quality work. I'd highly recommend them to anyone looking for a reliable web team.",
        initials: 'EK',
        name: 'Evan Kwan',
        role: 'Marketing Manager, Physitrack',
      }}
      trust={{ avatars: TAHI_TRUST_AVATARS, line: 'Trusted by some of the biggest companies.' }}
      showLegal={!hasAccount}
      helperText={trustCue}
      footerPrompt={hasAccount ? 'New here?' : 'Already have an account?'}
      footerLinkLabel={hasAccount ? 'Sign up' : 'Sign in'}
      footerLinkHref={hasAccount ? '/sign-up' : '/sign-in'}
    >
      {hasAccount ? (
        <ClerkSignIn appearance={tahiClerkAppearance} initialValues={initialValues} path="/sign-up" />
      ) : (
        <ClerkSignUp appearance={tahiClerkAppearance} initialValues={initialValues} />
      )}
    </AuthShell>
  )
}
