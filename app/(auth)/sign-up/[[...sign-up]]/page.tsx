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
      marketingHeadline="Run your studio from a single calm dashboard."
      valueProps={[
        { title: 'Win work faster', body: 'AI-drafted replies, discovery digests, and a pipeline that nudges itself.' },
        { title: 'Stay across the money', body: 'Live cash, burn and runway across NZD, USD, GBP and beyond.' },
        { title: 'Deliver with less friction', body: 'Requests, tasks, schedules and contracts wired together.' },
      ]}
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkHref="/sign-in"
    >
      <ClerkSignUp appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
