import { ClerkSignIn } from '@/components/tahi/clerk-mount'
import { AuthShell, tahiClerkAppearance } from '@/components/tahi/auth-shell'

export const metadata = {
  title: 'Sign in — Tahi Studio',
  description: 'Sign in to your Tahi Studio dashboard.',
}

export default function SignInPage() {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      marketingHeadline="Everything for your project, in one place."
      valueProps={[
        { title: 'Send requests without long email chains', body: 'Spin up a brief in a minute and the team picks it up from there.' },
        { title: 'See exactly where things are at', body: 'Track each request, what is next, and when to expect it.' },
        { title: 'Files, invoices and messages together', body: 'One calm space to chat with the Tahi team and find what you need.' },
      ]}
      footerPrompt="New to Tahi?"
      footerLinkLabel="Create an account"
      footerLinkHref="/sign-up"
    >
      <ClerkSignIn appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
