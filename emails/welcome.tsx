/**
 * <WelcomeEmail> — sent on client onboarding. Sets the tone for the
 * relationship: warm, brief, with a single clear CTA into the portal.
 */
import { Body, Head, Html, Preview, Section, Text } from '@react-email/components'
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

interface WelcomeEmailProps {
  contactName: string
  orgName: string
  dashboardUrl: string
}

const features: { title: string; body: string }[] = [
  { title: 'Submit and track requests',  body: 'Brief us on a piece of work and watch it move through review, in progress, and delivered.' },
  { title: 'Stay in the loop',           body: 'Updates land in your inbox and on the portal so nothing slips through the cracks.' },
  { title: 'Pay invoices in a click',    body: 'Stripe-powered checkout, receipts, and a full invoice history in one tab.' },
  { title: 'Message the team directly',  body: 'Per-request threads keep the conversation tied to the work, not buried in email.' },
]

const featureGridStyle = {
  display: 'block' as const,
  margin: '1.25rem 0',
} as const

const featureItemStyle = {
  background: EMAIL_TOKENS.brand50,
  border: `1px solid ${EMAIL_TOKENS.brand100}`,
  borderRadius: EMAIL_TOKENS.leafRadius,
  padding: '0.875rem 1rem',
  marginBottom: '0.625rem',
} as const

const featureTitleStyle = {
  color: EMAIL_TOKENS.brandDark,
  fontSize: '0.875rem',
  fontWeight: 700,
  letterSpacing: '-0.005em',
  margin: '0 0 0.25rem',
} as const

const featureBodyStyle = {
  color: EMAIL_TOKENS.text,
  fontSize: '0.8125rem',
  lineHeight: 1.55,
  margin: 0,
} as const

export function WelcomeEmail({
  contactName,
  orgName,
  dashboardUrl,
}: WelcomeEmailProps) {
  const firstName = contactName.split(' ')[0] ?? contactName
  return (
    <Html>
      <Head />
      <Preview>{`Welcome to Tahi Studio, ${firstName}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Welcome aboard" />

          <EmailCard>
            <EmailEyebrow>Hello</EmailEyebrow>
            <EmailHeading>
              Welcome to <span style={{ color: '#5A824E' }}>Tahi Studio</span>
            </EmailHeading>

            <EmailParagraph>Hi {firstName},</EmailParagraph>
            <EmailParagraph>
              We are delighted to have {orgName} as part of the Tahi family. Your portal is
              live and ready, and the team is briefed on the relationship. Here is what you
              can do from day one.
            </EmailParagraph>

            <Section style={featureGridStyle}>
              {features.map((f) => (
                <Section key={f.title} style={featureItemStyle}>
                  <Text style={featureTitleStyle}>{f.title}</Text>
                  <Text style={featureBodyStyle}>{f.body}</Text>
                </Section>
              ))}
            </Section>

            <PrimaryButton href={dashboardUrl}>Open your portal</PrimaryButton>

            <EmailFootnote>
              Got a question or need a hand getting set up? Just reply to this email or send
              us a message from the dashboard. We are here.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default WelcomeEmail
