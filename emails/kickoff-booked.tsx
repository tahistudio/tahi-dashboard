/**
 * <KickoffBookedEmail>. The client's confirmation after they pick a kickoff
 * slot at the end of onboarding. Sent to the contact who booked it, so the time
 * exists somewhere other than a screen they already navigated away from.
 *
 * Deliberately short: when, how long, who with, one link back to the portal,
 * and a plain line about rescheduling.
 */
import { Body, Head, Html, Preview } from '@react-email/components'
import { formatSlotLong } from '@/lib/kickoff-slot'
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
    <Html>
      <Head />
      <Preview>{`Your kickoff call is booked: ${when}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Kickoff booked" />

          <EmailCard>
            <EmailEyebrow>Kia ora {contactFirstName}</EmailEyebrow>
            <EmailHeading>Your kickoff call is booked.</EmailHeading>
            <EmailParagraph>
              {hostName
                ? `${hostName} will meet you to set direction for ${companyName}. No prep needed.`
                : `We will meet you to set direction for ${companyName}. No prep needed.`}
            </EmailParagraph>

            <DetailCard>
              <DetailRow label="When" value={when} hero first />
              <DetailRow label="How long" value={`${durationMinutes} minutes`} />
              {hostName ? <DetailRow label="With" value={hostName} /> : null}
            </DetailCard>

            {meetingUrl ? (
              <PrimaryButton href={meetingUrl}>Join the call</PrimaryButton>
            ) : (
              <PrimaryButton href={portalUrl}>Open your studio</PrimaryButton>
            )}

            <EmailParagraph subtle>
              Need a different time? Reply to this email and we will move it.
            </EmailParagraph>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}
