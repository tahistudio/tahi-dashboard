/**
 * <RequestDeliveredEmail>: sent to the client when the team marks a request
 * delivered. Friendly tone, prominent "view + review" CTA.
 *
 * recipientName and clientName are deliberately separate. The greeting is the
 * person reading it; the "Client" row is the company the work belongs to.
 * Feeding one value to both rendered "Client: Jo" under a company label, or
 * "Client: there" when the contact row had no usable name.
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
} from './_components'

interface RequestDeliveredEmailProps {
  requestTitle: string
  /** The person being greeted, first name already resolved. */
  recipientName: string
  /** The client company. Omitted when the caller does not know it. */
  clientName?: string | null
  deliveredAt: string
  /** Absolute URL for the request, resolved for the client's route map. */
  requestUrl: string
}

export function RequestDeliveredEmail({
  requestTitle,
  recipientName,
  clientName,
  deliveredAt,
  requestUrl,
}: RequestDeliveredEmailProps) {
  return (
    <EmailDocument preview={`Delivered: ${requestTitle}`}>
      <EmailCard>
        <EmailNav label="Client portal" />

        <EmailHero>
          <EmailKicker>Delivered</EmailKicker>
          <EmailHeading>Your work is ready for review</EmailHeading>
          <EmailParagraph>
            Hi {recipientName}, the team has wrapped up your request and the deliverables are
            waiting in the dashboard.
          </EmailParagraph>
        </EmailHero>

        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Request" value={requestTitle} tone="brand" />
            {clientName ? <LedgerRow label="Client" value={clientName} /> : null}
            <LedgerRow label="Delivered" value={deliveredAt} />
          </LedgerRows>

          <EmailParagraph variant="muted">
            Take a look when you have a moment. If anything needs a tweak, leave a comment
            on the thread or reply to this email and we will pick it up.
          </EmailParagraph>

          <PrimaryButton href={requestUrl}>View deliverables</PrimaryButton>

          <EmailParagraph variant="small">
            Tip: leaving feedback on the thread keeps everything in one place and helps the
            team move quickly on the next iteration.
          </EmailParagraph>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}

export default RequestDeliveredEmail
