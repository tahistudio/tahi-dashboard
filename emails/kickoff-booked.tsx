/**
 * <KickoffBookedEmail>. The client's confirmation after they pick a kickoff
 * slot at the end of onboarding. Sent to the contact who booked it, so the time
 * exists somewhere other than a screen they already navigated away from.
 *
 * Deliberately short: when, how long, who with, one link back to the portal,
 * and a plain line about rescheduling.
 */
import { formatSlotLong } from '@/lib/kickoff-slot'
import {
  Buttons,
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHero,
  EmailKicker,
  EmailHeading,
  EmailNav,
  EmailParagraph,
  Fact,
  Facts,
  LedgerRow,
  LedgerRows,
  PrimaryButton,
} from './_components'

export interface KickoffBookedEmailProps {
  /** First name of the person who booked, for the greeting. */
  contactFirstName: string
  /** Their company / workspace name. */
  companyName: string
  /** ISO timestamp of the booked slot. */
  scheduledAt: string
  /**
   * IANA zone to render the time in, normally the one the client picked in.
   * This template renders on a Cloudflare worker whose runtime clock is UTC, so
   * without it the confirmation would quote a time the client never chose.
   * Falls back to the studio's own zone, never to UTC.
   */
  timeZone?: string | null
  durationMinutes: number
  /** Studio host name, when one is assigned. */
  hostName?: string | null
  /** Video call link, when the studio calendar produced one. */
  meetingUrl?: string | null
  /** Absolute URL back into the client's portal. */
  portalUrl: string
}

export default function KickoffBookedEmail({
  contactFirstName,
  companyName,
  scheduledAt,
  timeZone,
  durationMinutes,
  hostName,
  meetingUrl,
  portalUrl,
}: KickoffBookedEmailProps) {
  const when = formatSlotLong(scheduledAt, { timeZone }) || scheduledAt

  return (
    <EmailDocument preview={`Your kickoff call is booked: ${when}`}>
      <EmailCard>
        <EmailNav label="Kickoff booked" />
        <EmailHero>
          <EmailKicker>Kickoff booked</EmailKicker>
          <EmailHeading>Kia ora {contactFirstName}, your kickoff call is booked.</EmailHeading>
          <EmailParagraph>
            {hostName
              ? `${hostName} will meet you to set direction for ${companyName}. No prep needed.`
              : `We will meet you to set direction for ${companyName}. No prep needed.`}
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <Facts>
            <Fact label="When" value={when} />
            <Fact label="How long" value={`${durationMinutes} minutes`} />
          </Facts>

          {hostName ? (
            <LedgerRows>
              <LedgerRow label="With" value={hostName} />
            </LedgerRows>
          ) : null}

          <Buttons>
            {meetingUrl ? (
              <PrimaryButton href={meetingUrl}>Join the call</PrimaryButton>
            ) : (
              <PrimaryButton href={portalUrl}>Open your studio</PrimaryButton>
            )}
          </Buttons>

          <EmailParagraph variant="small">
            Need a different time? Reply to this email and we will move it.
          </EmailParagraph>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}
