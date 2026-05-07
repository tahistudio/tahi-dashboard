/**
 * <ScheduleShareEmail> — the "your project schedule is ready" email.
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

interface ScheduleShareEmailProps {
  recipientName: string
  scheduleTitle: string
  scheduleSubtitle?: string | null
  viewUrl: string
  fromName: string
  customMessage?: string | null
  targetLaunchDate?: string | null
}

export function ScheduleShareEmail({
  recipientName,
  scheduleTitle,
  scheduleSubtitle,
  viewUrl,
  fromName,
  customMessage,
  targetLaunchDate,
}: ScheduleShareEmailProps) {
  const launchLabel = targetLaunchDate
    ? new Date(targetLaunchDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  const firstName = recipientName.split(' ')[0] ?? recipientName

  return (
    <Html>
      <Head />
      <Preview>{`${fromName} has shared the project schedule for ${scheduleTitle}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Your project schedule" />

          <EmailCard>
            <EmailEyebrow>Project schedule</EmailEyebrow>
            <EmailHeading>
              The <span style={{ color: '#5A824E' }}>plan</span> is ready
            </EmailHeading>

            <EmailParagraph>Hi {firstName},</EmailParagraph>
            <EmailParagraph>
              {fromName} has shared the project schedule below. It walks through the high-level
              Gantt, the month-by-month detail, the risk register, and the RACI matrix.
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Project" value={scheduleTitle} hero />
              {scheduleSubtitle && <DetailRow label="Scope" value={scheduleSubtitle} />}
              {launchLabel && <DetailRow label="Target launch" value={launchLabel} />}
            </DetailCard>

            {customMessage && (
              <MessageBlock fromName={fromName} message={customMessage} />
            )}

            <PrimaryButton href={viewUrl}>View schedule</PrimaryButton>

            <EmailFootnote>
              Anything need to shift? Reply to this email and we will update the plan together.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default ScheduleShareEmail
