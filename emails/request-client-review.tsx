/**
 * <RequestClientReviewEmail>: a request has moved to client review, so the
 * work is finished and the studio is now waiting on the client.
 *
 * Deliberately not the delivered email. Delivered says "here it is"; this one
 * says "we need you". The CTA lands on the request thread, which is where the
 * approve and request-changes controls live.
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
    <Html>
      <Head />
      <Preview>{`Ready for your review: ${requestTitle}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Ready for your review" />

          <EmailCard>
            <EmailBanner kind="info">Waiting on you</EmailBanner>
            <EmailEyebrow>Your review</EmailEyebrow>
            <EmailHeading>
              Your request is <span style={{ color: '#5A824E' }}>ready for your review</span>
            </EmailHeading>

            <EmailParagraph>
              Hi {recipientName}, we have finished this one and it is waiting on you. Open the
              request to look it over, then either approve it or tell us what to change.
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Request" value={requestTitle} hero />
              {reference && <DetailRow label="Reference" value={reference} mono />}
              <DetailRow label="Status" value="Ready for your review" />
            </DetailCard>

            <PrimaryButton href={reviewUrl}>Review this request</PrimaryButton>

            <EmailFootnote>
              Nothing moves on until you have looked. If it needs another pass, requesting
              changes on the thread sends it straight back to us with your notes attached.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default RequestClientReviewEmail
