/**
 * <ProposalShareEmail> - the "your proposal is ready" email.
 *
 * Sent to the prospect with a unique view URL. The proposal viewer itself
 * is the cinematic part; this email is a respectful invitation to open it.
 */
import {
  BlockQuote,
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailFootnote,
  EmailHero,
  EmailHeading,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  LedgerRow,
  LedgerRows,
  PrimaryButton,
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
    <EmailDocument preview={`${fromName} has shared a proposal: ${proposalTitle}`}>
      <EmailCard>
        <EmailNav label="Proposal" />
        <EmailHero>
          <EmailKicker>Proposal</EmailKicker>
          <EmailHeading>Kia ora {firstName}, your proposal is ready.</EmailHeading>
          <EmailParagraph>
            {fromName} has shared a proposal for your review. It covers the scope, the team, the
            math behind the price, and the path from project to ongoing care. The deck opens in your
            browser, no sign in required.
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <LedgerRows>
            <LedgerRow label={proposalSubtitle ? 'For' : 'Proposal'} value={proposalTitle} tone="brand" />
            {proposalSubtitle && <LedgerRow label="Scope" value={proposalSubtitle} />}
            {expiresLabel && <LedgerRow label="Open until" value={expiresLabel} />}
          </LedgerRows>

          {customMessage && <BlockQuote attribution={fromName}>{customMessage}</BlockQuote>}

          <PrimaryButton href={viewUrl}>View proposal</PrimaryButton>

          <EmailFootnote>
            Have a question or want a tweak? You can ask from inside the proposal without committing.
            The deck stays open while we reply.
          </EmailFootnote>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}

export default ProposalShareEmail
