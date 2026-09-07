import { AuthShell } from '@/components/tahi/auth-shell'
import { TAHI_TRUST_AVATARS } from '@/lib/auth-shell-config'
import { ChooseWorkspaceContent } from './continue-content'

export const metadata = {
  title: 'Opening your workspace - Tahi Studio',
  description: 'Choosing the workspace to open for your Tahi Studio account.',
}

/**
 * /continue. The landing spot for a signed-in session that has no
 * ACTIVE Clerk organisation yet.
 *
 * A Clerk session carries one active org, not a membership list, so a person
 * who just accepted an organisation invitation and signed in fresh arrives with
 * orgId === null even though they belong somewhere. The middleware used to read
 * that as "lead" and send them into client onboarding. Now it sends them here,
 * and the client component below asks Clerk for the real membership list and
 * calls setActive.
 */
export default function ChooseWorkspacePage() {
  return (
    <AuthShell
      centeredScene
      pill="Your workspace"
      headline="One moment."
      sub="We are opening the right workspace for you."
      trust={{ avatars: TAHI_TRUST_AVATARS, line: 'Trusted by some of the biggest companies.' }}
      footerPrompt="Not where you expected to be?"
      footerLinkLabel="Start onboarding"
      footerLinkHref="/onboarding"
    >
      <ChooseWorkspaceContent />
    </AuthShell>
  )
}
