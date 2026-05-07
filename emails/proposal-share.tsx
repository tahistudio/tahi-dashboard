/**
 * <ProposalShareEmail> — the "your proposal is ready" email.
 *
 * Sent to the prospect with a unique view URL. The proposal viewer itself
 * is the cinematic part; this email is a respectful invitation to open it.
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
  MessageBlock,
  PrimaryButton,
  emailBodyStyle,
} from './_components'

interface ProposalShareEmailProps {
  recipientName: string
  proposalTitle: string
  proposalSubtitle?: string | null
  viewUrl: string
  fromName: string
  customMessage?: string | null
  expiresAt?: string | null  // ISO
}

export function ProposalShareEmail({
  recipientName,
  proposalTitle,
  proposalSubtitle,
  viewUrl,
  fromName,
  customMessage,
  expiresAt,
}: ProposalShareEmailProps) {
  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  const firstName = recipientName.split(' ')[0] ?? recipientName

  return (
    <Html>
      <Head />
      <Preview>{`${fromName} has shared a proposal: ${proposalTitle}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="A proposal, ready to read" />

          <EmailCard>
            <EmailEyebrow>Proposal</EmailEyebrow>
            <EmailHeading>
              Your <span style={{ color: '#5A824E' }}>proposal</span> is ready
            </EmailHeading>

            <EmailParagraph>Hi {firstName},</EmailParagraph>
            <EmailParagraph>
              {fromName} has shared a proposal for your review. It covers the scope, the team,
              the math behind the price, and the path from project to ongoing care. The deck
              opens in your browser, no sign-in required.
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label={proposalSubtitle ? 'For' : 'Proposal'} value={proposalTitle} hero />
              {proposalSubtitle && <DetailRow label="Scope" value={proposalSubtitle} />}
              {expiresLabel && <DetailRow label="Open until" value={expiresLabel} />}
            </DetailCard>

            {customMessage && (
              <MessageBlock fromName={fromName} message={customMessage} />
            )}

            <PrimaryButton href={viewUrl}>View proposal</PrimaryButton>

            <EmailFootnote>
              Have a question or want a tweak? You can ask from inside the proposal without
              committing. The deck stays open while we reply.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default ProposalShareEmail
