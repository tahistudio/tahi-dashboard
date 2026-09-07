/**
 * <NewRequestEmail>: admin-facing notification when a client submits a
 * request. Lands in the team inbox and the request author's confirmation.
 */
import {
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHero,
  EmailHeading,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  LedgerRow,
  LedgerRows,
  PrimaryButton,
  SecondaryLink,
} from './_components'

interface NewRequestEmailProps {
  requestTitle: string
  clientName: string
  category?: string
  priority?: string
  submittedBy?: string
  dashboardUrl: string
  requestId: string
  /** The per-org request number the subject quotes, e.g. 42 for REQ-42. */
  requestNumber?: number | null
}

export function NewRequestEmail({
  requestTitle,
  clientName,
  category,
  priority,
  submittedBy,
  dashboardUrl,
  requestId,
  requestNumber,
}: NewRequestEmailProps) {
  const requestUrl = `${dashboardUrl}/requests/${requestId}`
  // The same REQ-n the subject carries. A UUID fragment is not a reference
  // anyone can quote back, so a request without a number shows none.
  const reference = requestNumber ? `REQ-${requestNumber}` : null

  return (
    <EmailDocument preview={`New request: ${requestTitle}`}>
      <EmailCard>
        <EmailNav label={reference ?? 'New request'} />

        <EmailHero>
          <EmailKicker>New request</EmailKicker>
          <EmailHeading>{requestTitle}</EmailHeading>
          <EmailParagraph variant="muted">
            {submittedBy
              ? `${submittedBy} just submitted this for ${clientName}. Open it in Triage to take a look.`
              : `A new request has come in for ${clientName}. Open it in Triage to take a look.`}
          </EmailParagraph>
        </EmailHero>

        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Client" value={clientName} />
            {category ? <LedgerRow label="Category" value={category} /> : null}
            {priority ? <LedgerRow label="Priority" value={priority} /> : null}
            {reference ? <LedgerRow label="Reference" value={reference} mono /> : null}
          </LedgerRows>

          <PrimaryButton href={requestUrl}>Open in Triage</PrimaryButton>
          <SecondaryLink href={`${requestUrl}?assign=me`}>Assign to me</SecondaryLink>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="team" />
    </EmailDocument>
  )
}

export default NewRequestEmail
