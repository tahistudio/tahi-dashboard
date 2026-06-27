import { ClerkSignUp } from '@/components/tahi/clerk-mount'
import { AuthShell, tahiClerkAppearance, TAHI_TRUST_AVATARS } from '@/components/tahi/auth-shell'

export const metadata = {
  title: 'Create your workspace - Tahi Studio',
  description: 'Get started with Tahi Studio.',
}

export default function SignUpPage() {
  return (
    <AuthShell
      pill="Your workspace"
      headline="Your project, start to finish, in one place."
      sub="From the first brief to the final invoice, you can always see where things stand."
      testimonial={{
        quote: 'Calm, sharp, and exactly the kind of partner we hoped for. Everything in one place, nothing dropped.',
        initials: 'MK',
        name: 'Mereana K.',
        role: 'Founder, Kōwhai Studio',
      }}
      trust={{ avatars: TAHI_TRUST_AVATARS, line: 'Trusted by independent studios.' }}
      showLegal
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkHref="/sign-in"
    >
      <ClerkSignUp appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
