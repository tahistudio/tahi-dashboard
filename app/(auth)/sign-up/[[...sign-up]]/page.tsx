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
        quote: "Tahi have been brilliant to work with. Friendly, fast, and always delivering high quality work. I'd highly recommend them to anyone looking for a reliable web team.",
        initials: 'EK',
        name: 'Evan Kwan',
        role: 'Marketing Manager, Physitrack',
      }}
      trust={{ avatars: TAHI_TRUST_AVATARS, line: 'Trusted by some of the biggest companies.' }}
      showLegal
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkHref="/sign-in"
    >
      <ClerkSignUp appearance={tahiClerkAppearance} />
    </AuthShell>
  )
}
