import { ClerkSignIn } from '@/components/tahi/clerk-mount'
import { AuthShell, tahiClerkAppearance } from '@/components/tahi/auth-shell'

export const metadata = {
  title: 'Sign in - Tahi Studio',
  description: 'Sign in to your Tahi Studio workspace.',
}

export default function SignInPage() {
  return (
    <AuthShell
      centeredScene
      pill="The studio workspace"
      headline="Welcome back."
      sub="Your studio workspace, right where you left it."
      testimonial={{
        quote: 'Calm, sharp, and exactly the kind of partner we hoped for. Everything in one place, nothing dropped.',
        initials: 'MK',
        name: 'Mereana K.',
        role: 'Founder, Kōwhai Studio',
      }}
      cardTitle="Welcome back"
      cardSubtitle="Sign in to your workspace."
      helperText="Encrypted and secure."
      footerPrompt="New here?"
      footerLinkLabel="Talk to the studio"
      footerLinkHref="mailto:business@tahi.studio"
    >
      <ClerkSignIn appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
