/**
 * <ProposalDecisionEmail>: admin-facing notification when a prospect responds
 * to a shared proposal. One template, three voices (accepted / declined /
 * question), because all three are the same event told to the same audience:
 * "a shared link just got acted on, go look."
 */
import {
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHero,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  LedgerRow,
  LedgerRows,
  NoteBox,
  PrimaryButton,
} from './_components'

export type ProposalDecision = 'accepted' | 'declined' | 'question'

interface ProposalDecisionEmailProps {
  decision: ProposalDecision
  proposalId: string
  proposalTitle: string
  clientName: string
  dashboardUrl: string
  /** The variant name the prospect accepted, if any. */
  variantName?: string | null
  /** The prospect's own words, present only on a question. */
  comment?: string | null
  /** Who left the decision, when they gave a name. */
  acceptorName?: string | null
}

const KICKER: Record<ProposalDecision, string> = {
  accepted: 'Proposal accepted',
  declined: 'Proposal declined',
  question: 'Question on a proposal',
}

const NOTE_TONE: Record<ProposalDecision, 'brand' | 'danger' | 'amber'> = {
  accepted: 'brand',
  declined: 'danger',
  question: 'amber',
}

function lede(decision: ProposalDecision, clientName: string): string {
  if (decision === 'accepted') return `${clientName} accepted this proposal. Time to reply within one business day, the way the viewer promised them.`
  if (decision === 'declined') return `${clientName} declined this proposal.`
  return `${clientName} left a question on this proposal instead of a decision.`
}

export function ProposalDecisionEmail({
  decision,
  proposalId,
  proposalTitle,
  clientName,
  dashboardUrl,
  variantName,
  comment,
  acceptorName,
}: ProposalDecisionEmailProps) {
  const proposalUrl = `${dashboardUrl}/proposals/${proposalId}`

  return (
    <EmailDocument preview={`${KICKER[decision]}: ${proposalTitle}`}>
      <EmailCard>
        <EmailNav label={KICKER[decision]} />

        <EmailHero>
          <EmailKicker tone={decision === 'declined' ? 'danger' : decision === 'question' ? 'amber' : 'brand'}>
            {KICKER[decision]}
          </EmailKicker>
          <EmailParagraph variant="muted">{lede(decision, clientName)}</EmailParagraph>
        </EmailHero>

        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Proposal" value={proposalTitle} />
            <LedgerRow label="Client" value={clientName} />
            {acceptorName ? <LedgerRow label="Left by" value={acceptorName} /> : null}
            {variantName ? <LedgerRow label="Variant" value={variantName} /> : null}
          </LedgerRows>

          {comment ? (
            <NoteBox tone={NOTE_TONE[decision]} title={decision === 'question' ? 'Their question' : 'Their note'}>
              {comment}
            </NoteBox>
          ) : null}

          <PrimaryButton href={proposalUrl}>Open the proposal</PrimaryButton>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="team" />
    </EmailDocument>
  )
}

export default ProposalDecisionEmail
