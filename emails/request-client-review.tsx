/**
 * <RequestClientReviewEmail>: a request has moved to client review, so the
 * work is finished and the studio is now waiting on the client.
 *
 * Deliberately not the delivered email. Delivered says "here it is"; this one
 * says "we need you". The CTA lands on the request thread, which is where the
 * approve and request-changes controls live.
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

interface RequestClientReviewEmailProps {
  recipientName: string
  requestTitle: string
  requestNumber: number | null
  reviewUrl: string
}

export function RequestClientReviewEmail({
  recipientName,
  requestTitle,
  requestNumber,
  reviewUrl,
}: RequestClientReviewEmailProps) {
  const reference = requestNumber ? `REQ-${requestNumber}` : null

  return (
    <EmailDocument preview={`Ready for your review: ${requestTitle}`}>
      <EmailCard>
        <EmailNav label={reference ?? 'Client portal'} />

        <EmailHero>
          <EmailKicker>Ready for review</EmailKicker>
          <EmailHeading>Your request is ready for review</EmailHeading>
          <EmailParagraph>
            Hi {recipientName}, we have finished this one and it is waiting on you. Open the
            request to look it over, then either approve it or tell us what to change.
          </EmailParagraph>
        </EmailHero>

        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Request" value={requestTitle} tone="brand" />
            {reference ? <LedgerRow label="Reference" value={reference} mono /> : null}
            <LedgerRow label="Next" value="Waiting on you" />
          </LedgerRows>

          <PrimaryButton href={reviewUrl}>Review and comment</PrimaryButton>
          <SecondaryLink href={reviewUrl}>Approve as is</SecondaryLink>

          <EmailParagraph variant="small">
            Nothing moves on until you have looked. If it needs another pass, requesting
            changes on the thread sends it straight back to us with your notes attached.
          </EmailParagraph>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}

export default RequestClientReviewEmail
