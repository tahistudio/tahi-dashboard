import { ClerkSignUp } from '@/components/tahi/clerk-mount'
import { AuthShell, tahiClerkAppearance, TAHI_TRUST_AVATARS } from '@/components/tahi/auth-shell'

export const metadata = {
  title: 'Create your workspace - Tahi Studio',
  description: 'Get started with Tahi Studio.',
}

export default function SignUpPage() {
  return (
    <AuthShell
      pill="The studio workspace"
      headline="Welcome to your Tahi Studio dashboard."
      sub="Brief your studio, track delivery, and receive every file and invoice - all in one place."
      testimonial={{
        quote: 'Calm, sharp, and exactly the kind of partner we hoped for. Everything in one place, nothing dropped.',
        initials: 'MK',
        name: 'Mereana K.',
        role: 'Founder, Kōwhai Studio',
      }}
      trust={{ avatars: TAHI_TRUST_AVATARS, line: 'Trusted by independent studios.' }}
      cardTitle="Create your workspace"
      cardSubtitle="Takes about a minute."
      helperText="No card required. Your data stays private to your studio."
      showLegal
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkHref="/sign-in"
    >
      <ClerkSignUp appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
