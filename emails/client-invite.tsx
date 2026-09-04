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
import { Body, Head, Html, Preview } from '@react-email/components'
import {
  DetailCard,
  DetailRow,
  EmailCard,
  EmailEyebrow,
  EmailFooter,
  EmailFootnote,
  EmailHeader,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  PrimaryButton,
  emailBodyStyle,
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
    timeZone: 'UTC',
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
    <Html>
      <Head />
      <Preview>{`Your Tahi Studio portal is ready, ${firstName}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Portal invite" />

          <EmailCard>
            <EmailEyebrow>You are invited</EmailEyebrow>
            <EmailHeading>
              Your <span style={{ color: '#5A824E' }}>portal</span> is ready
            </EmailHeading>

            <EmailParagraph>Hi {firstName},</EmailParagraph>
            <EmailParagraph>
              {sender} has set up the {orgName} workspace on the Tahi Studio portal. Use the
              button below to claim your access. It signs you straight into the workspace we
              built for you, so there is nothing to set up and nothing to pay for here.
            </EmailParagraph>

            <PrimaryButton href={inviteUrl}>Claim your access</PrimaryButton>

            <DetailCard>
              <DetailRow label="Workspace" value={orgName} first />
              <DetailRow label="Invite sent to" value={boundEmail} />
              {expiry ? <DetailRow label="Link valid until" value={expiry} /> : null}
            </DetailCard>

            <EmailParagraph subtle>
              This link only works for {boundEmail}, so forwarding it will not give anyone
              else access.
            </EmailParagraph>

            <EmailFootnote>
              Not expecting this, or need it sent to a different address? Just reply to this
              email and we will sort it out.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default ClientInviteEmail
