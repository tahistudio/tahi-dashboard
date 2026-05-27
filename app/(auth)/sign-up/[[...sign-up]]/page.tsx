import { ClerkSignUp } from '@/components/tahi/clerk-mount'
import { AuthShell, tahiClerkAppearance } from '@/components/tahi/auth-shell'

export const metadata = {
  title: 'Create your account — Tahi Studio',
  description: 'Get started with Tahi Studio.',
}

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="A minute to set up. Everything in one place after that."
      marketingHeadline="Everything for your project, in one place."
      valueProps={[
        { title: 'Send requests without long email chains', body: 'Spin up a brief in a minute and the team picks it up from there.' },
        { title: 'See exactly where things are at', body: 'Track each request, what is next, and when to expect it.' },
        { title: 'Files, invoices and messages together', body: 'One calm space to chat with the Tahi team and find what you need.' },
      ]}
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkHref="/sign-in"
    >
      <ClerkSignUp appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
