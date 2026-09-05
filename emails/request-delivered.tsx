/**
 * <RequestDeliveredEmail>: sent to the client when the team marks a request
 * delivered. Friendly tone, prominent "view + review" CTA.
 *
 * recipientName and clientName are deliberately separate. The greeting is the
 * person reading it; the "Client" row is the company the work belongs to.
 * Feeding one value to both rendered "Client: Jo" under a company label, or
 * "Client: there" when the contact row had no usable name.
 */
import { Body, Head, Html, Preview } from '@react-email/components'
import {
  DetailCard,
  DetailRow,
  EmailBanner,
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
    <Html>
      <Head />
      <Preview>{`Delivered: ${requestTitle}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Your request is delivered" />

          <EmailCard>
            <EmailBanner kind="success">Delivered</EmailBanner>
            <EmailEyebrow>Request complete</EmailEyebrow>
            <EmailHeading>
              Your work is <span style={{ color: '#5A824E' }}>ready</span> for review
            </EmailHeading>

            <EmailParagraph>
              Hi {recipientName}, the team has wrapped up your request and the
              deliverables are waiting in the dashboard.
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Request" value={requestTitle} hero />
              {clientName && <DetailRow label="Client" value={clientName} />}
              <DetailRow label="Delivered" value={deliveredAt} />
            </DetailCard>

            <EmailParagraph>
              Take a look when you have a moment. If anything needs a tweak, leave a comment
              on the thread or reply to this email and we will pick it up.
            </EmailParagraph>

            <PrimaryButton href={requestUrl}>View deliverables</PrimaryButton>

            <EmailFootnote>
              Tip: leaving feedback on the thread keeps everything in one place and helps the
              team move quickly on the next iteration.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default RequestDeliveredEmail
