/**
 * <ClientInviteEmail>: the "here is your way in" email.
 *
 * Sent when the studio mints an onboarding invite for a named contact. The CTA
 * carries the invite token, so following it lands the person in the workspace
 * Tahi already created for them instead of provisioning a fresh empty one.
 *
 * The link is bound to this recipient's email address server side (see
 * app/api/portal/accept-invite/route.ts), which is why the copy says so plainly
 * and why forwarding it is useless.
 */
import { STUDIO_TIME_ZONE } from '@/lib/kickoff-slot'
import {
  Buttons,
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHero,
  EmailKicker,
  EmailHeading,
  EmailNav,
  EmailParagraph,
  LedgerRow,
  LedgerRows,
  PrimaryButton,
} from './_components'

interface ClientInviteEmailProps {
  contactName: string
  orgName: string
  inviteUrl: string
  /** The address the link is bound to. Shown so a mismatch is self-diagnosing. */
  boundEmail: string
  /** ISO timestamp. Rendered as a plain date when present. */
  expiresAt?: string | null
  /** Who sent it, e.g. "Liam Miller". Falls back to the studio name. */
  fromName?: string | null
}

function formatExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    // The recipient reads this in New Zealand. UTC understated the last
    // valid day by one for every expiry after 12:00 UTC.
    timeZone: STUDIO_TIME_ZONE,
  })
}

export function ClientInviteEmail({
  contactName,
  orgName,
  inviteUrl,
  boundEmail,
  expiresAt,
  fromName,
}: ClientInviteEmailProps) {
  const firstName = contactName.split(' ')[0] ?? contactName
  const expiry = formatExpiry(expiresAt)
  const sender = fromName?.trim() || 'the Tahi Studio team'

  return (
    <EmailDocument preview={`Your Tahi Studio portal is ready, ${firstName}`}>
      <EmailCard>
        <EmailNav label="Invitation" />
        <EmailHero>
          <EmailKicker>You are invited</EmailKicker>
          <EmailHeading>Your portal is ready.</EmailHeading>
          <EmailParagraph>
            Hi {firstName}, {sender} has set up the {orgName} workspace on the Tahi Studio
            portal. Use the button below to claim your access. It signs you straight into the
            workspace we built for you, so there is nothing to set up and nothing to pay for
            here.
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Joining as" value={orgName} />
            <LedgerRow label="Invite sent to" value={boundEmail} />
            {expiry ? <LedgerRow label="Link valid until" value={expiry} /> : null}
          </LedgerRows>

          <Buttons>
            <PrimaryButton href={inviteUrl}>Accept invitation</PrimaryButton>
          </Buttons>

          <EmailParagraph variant="small">
            This link only works for {boundEmail}, so forwarding it will not give anyone else
            access. Not expecting this, or need it sent to a different address? Just reply to
            this email and we will sort it out.
          </EmailParagraph>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" recipientEmail={boundEmail} />
    </EmailDocument>
  )
}

export default ClientInviteEmail
