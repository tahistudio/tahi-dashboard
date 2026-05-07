/**
 * <ReviewRequestEmail> — testimonial outreach: ask a happy client whether
 * they would be open to leaving a review. Three answer paths embedded as
 * tracked links: yes / defer / no.
 */
import { Body, Head, Html, Link, Preview, Section } from '@react-email/components'
import {
  EMAIL_TOKENS,
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

interface ReviewRequestEmailProps {
  clientName: string
  orgName: string
  respondUrl: string
  token: string
}

const secondaryRowStyle = {
  textAlign: 'center' as const,
  margin: '0.5rem 0 0',
} as const

const secondaryButtonStyle = {
  display: 'inline-block',
  fontSize: '0.8125rem',
  fontWeight: 600,
  padding: '0.625rem 1.125rem',
  borderRadius: '0.5rem',
  textDecoration: 'none',
  background: EMAIL_TOKENS.surface,
  color: EMAIL_TOKENS.textMuted,
  border: `1px solid ${EMAIL_TOKENS.border}`,
  marginRight: '0.5rem',
} as const

const tertiaryStyle = {
  color: EMAIL_TOKENS.textSubtle,
  fontSize: '0.8125rem',
  textDecoration: 'underline',
  fontWeight: 500,
} as const

export function ReviewRequestEmail({
  clientName,
  orgName,
  respondUrl,
  token,
}: ReviewRequestEmailProps) {
  const yesUrl   = `${respondUrl}?token=${token}&answer=yes`
  const deferUrl = `${respondUrl}?token=${token}&answer=defer`
  const noUrl    = `${respondUrl}?token=${token}&answer=no`
  const firstName = clientName.split(' ')[0] ?? clientName

  return (
    <Html>
      <Head />
      <Preview>{`We would love your feedback, ${firstName}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="A quick favour" />

          <EmailCard>
            <EmailEyebrow>How was it?</EmailEyebrow>
            <EmailHeading>
              Would you share a <span style={{ color: '#5A824E' }}>kind word</span>?
            </EmailHeading>

            <EmailParagraph>Hi {firstName},</EmailParagraph>
            <EmailParagraph>
              We have loved working with {orgName} and would really appreciate hearing about
              your experience. A short review helps us improve and helps other businesses
              decide if Tahi is right for them.
            </EmailParagraph>
            <EmailParagraph>
              It takes a couple of minutes. Are you open to it?
            </EmailParagraph>

            <PrimaryButton href={yesUrl}>Yes, happy to</PrimaryButton>

            <Section style={secondaryRowStyle}>
              <Link href={deferUrl} style={secondaryButtonStyle}>Not right now</Link>
              <Link href={noUrl} style={tertiaryStyle}>No thanks</Link>
            </Section>

            <EmailFootnote>
              No pressure either way. We will not ask again unless you tell us to.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default ReviewRequestEmail
