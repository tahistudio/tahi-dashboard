/**
 * <NewRequestEmail> — admin-facing notification when a client submits a
 * request. Lands in the team inbox and the request author's confirmation.
 */
import { Body, Head, Html, Preview } from '@react-email/components'
import {
  DetailCard,
  DetailRow,
  EmailCard,
  EmailEyebrow,
  EmailFooter,
  EmailHeader,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  PrimaryButton,
  emailBodyStyle,
} from './_components'

interface NewRequestEmailProps {
  requestTitle: string
  clientName: string
  category?: string
  priority?: string
  submittedBy?: string
  dashboardUrl: string
  requestId: string
}

export function NewRequestEmail({
  requestTitle,
  clientName,
  category,
  priority,
  submittedBy,
  dashboardUrl,
  requestId,
}: NewRequestEmailProps) {
  const requestUrl = `${dashboardUrl}/requests/${requestId}`

  return (
    <Html>
      <Head />
      <Preview>{`New request: ${requestTitle}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="New request submitted" />

          <EmailCard>
            <EmailEyebrow>Inbox</EmailEyebrow>
            <EmailHeading>
              A <span style={{ color: '#5A824E' }}>new request</span> has landed
            </EmailHeading>

            <EmailParagraph>
              {submittedBy
                ? `${submittedBy} just submitted a new request for ${clientName}. Open it in the dashboard to triage and assign.`
                : `A new request has been submitted for ${clientName}. Open it in the dashboard to triage and assign.`}
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Title" value={requestTitle} hero />
              <DetailRow label="Client" value={clientName} />
              {category && <DetailRow label="Category" value={category} />}
              {priority && <DetailRow label="Priority" value={priority} />}
              <DetailRow label="Request ID" value={requestId.slice(0, 8).toUpperCase()} mono />
            </DetailCard>

            <PrimaryButton href={requestUrl}>Open request</PrimaryButton>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default NewRequestEmail
