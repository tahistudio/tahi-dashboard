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
      marketingHeadline="One dashboard. Every part of your studio."
      valueProps={[
        { title: 'Sales pipeline that actually moves', body: 'Discovery calls, proposals, and contracts in one trail.' },
        { title: 'Finance you can read at a glance', body: 'Cash, MRR, burn and runway live in NZD or your chosen currency.' },
        { title: 'Client work without the busywork', body: 'Requests, files and messages all in their right place.' },
      ]}
      footerPrompt="New to Tahi?"
      footerLinkLabel="Create an account"
      footerLinkHref="/sign-up"
    >
      <ClerkSignIn appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
