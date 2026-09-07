/**
 * <ScheduleShareEmail> - the "your project schedule is ready" email.
 */
import { STUDIO_TIME_ZONE } from '@/lib/kickoff-slot'
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
    ? new Date(targetLaunchDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: STUDIO_TIME_ZONE })
    : null
  const firstName = recipientName.split(' ')[0] ?? recipientName

  return (
    <EmailDocument preview={`${fromName} has shared the project schedule for ${scheduleTitle}`}>
      <EmailCard>
        <EmailNav label="Project schedule" />
        <EmailHero>
          <EmailKicker>Project schedule</EmailKicker>
          <EmailHeading>Kia ora {firstName}, the plan is ready.</EmailHeading>
          <EmailParagraph>
            {fromName} has shared the project schedule below. It walks through the high-level Gantt,
            the month by month detail, the risk register, and the RACI matrix.
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Project" value={scheduleTitle} tone="brand" />
            {scheduleSubtitle && <LedgerRow label="Scope" value={scheduleSubtitle} />}
            {launchLabel && <LedgerRow label="Target launch" value={launchLabel} />}
          </LedgerRows>

          {customMessage && <BlockQuote attribution={fromName}>{customMessage}</BlockQuote>}

          <PrimaryButton href={viewUrl}>View schedule</PrimaryButton>

          <EmailFootnote>
            Anything need to shift? Reply to this email and we will update the plan together.
          </EmailFootnote>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}

export default ScheduleShareEmail
