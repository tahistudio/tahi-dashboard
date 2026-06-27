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
      pill="Your workspace"
      headline="Welcome back."
      sub="Your project, right where you left it."
      testimonial={{
        quote: 'Calm, sharp, and exactly the kind of partner we hoped for. Everything in one place, nothing dropped.',
        initials: 'MK',
        name: 'Mereana K.',
        role: 'Founder, Kōwhai Studio',
      }}
      footerPrompt="Don't have an account?"
      footerLinkLabel="Sign up"
      footerLinkHref="/sign-up"
    >
      <ClerkSignIn appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
