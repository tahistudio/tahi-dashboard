/**
 * <RequestDeliveredEmail> — sent to the client when the team marks a
 * request delivered. Friendly tone, prominent "view + review" CTA.
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
  clientName: string
  deliveredAt: string
  dashboardUrl: string
  requestId: string
}

export function RequestDeliveredEmail({
  requestTitle,
  clientName,
  deliveredAt,
  dashboardUrl,
  requestId,
}: RequestDeliveredEmailProps) {
  const requestUrl = `${dashboardUrl}/requests/${requestId}`

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
              Hi {clientName.split(' ')[0]}, the team has wrapped up your request and the
              deliverables are waiting in the dashboard.
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Request" value={requestTitle} hero />
              <DetailRow label="Client" value={clientName} />
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
