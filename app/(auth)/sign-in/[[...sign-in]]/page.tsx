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
        quote: "Tahi have been brilliant to work with. Friendly, fast, and always delivering high quality work. I'd highly recommend them to anyone looking for a reliable web team.",
        initials: 'EK',
        name: 'Evan Kwan',
        role: 'Marketing Manager, Physitrack',
      }}
      footerPrompt="Don't have an account?"
      footerLinkLabel="Sign up"
      footerLinkHref="/sign-up"
    >
      <ClerkSignIn appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
