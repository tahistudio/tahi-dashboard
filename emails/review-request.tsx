import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
  Hr,
} from '@react-email/components'

interface ReviewRequestEmailProps {
  clientName: string
  orgName: string
  respondUrl: string
  token: string
}

export function ReviewRequestEmail({
  clientName,
  orgName,
  respondUrl,
  token,
}: ReviewRequestEmailProps) {
  const yesUrl = `${respondUrl}?token=${token}&answer=yes`
  const deferUrl = `${respondUrl}?token=${token}&answer=defer`
  const noUrl = `${respondUrl}?token=${token}&answer=no`

  return (
    <Html>
      <Head />
      <Preview>We would love your feedback, {clientName}!</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Heading style={logoStyle}>Tahi Studio</Heading>
          </Section>

          <Section style={contentStyle}>
            <Heading as="h2" style={headingStyle}>
              How has your experience been?
            </Heading>

            <Text style={textStyle}>
              Hi {clientName},
            </Text>

            <Text style={textStyle}>
              We have loved working with {orgName} and would really appreciate
              hearing about your experience. Your feedback helps us improve and
              also helps other businesses discover Tahi Studio.
            </Text>

            <Text style={textStyle}>
              It only takes a couple of minutes. Would you be open to sharing
              a quick review?
            </Text>

            <Section style={buttonGroupStyle}>
              <Link href={yesUrl} style={primaryButtonStyle}>
                Yes, happy to
              </Link>
            </Section>

            <Section style={secondaryButtonGroupStyle}>
              <Link href={deferUrl} style={secondaryButtonStyle}>
                Not right now
              </Link>
              <Text style={spacerStyle}>&nbsp;&nbsp;</Text>
              <Link href={noUrl} style={tertiaryButtonStyle}>
                No thanks
              </Link>
            </Section>
          </Section>

          <Hr style={hrStyle} />

          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              Tahi Studio Dashboard
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default ReviewRequestEmail

// -- Styles --

const bodyStyle = {
  backgroundColor: '#f5f7f5',
  fontFamily: 'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  margin: '0',
  padding: '0',
} as const

const containerStyle = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '2rem 0',
} as const

const headerStyle = {
  padding: '1.5rem 2rem',
  textAlign: 'center' as const,
} as const

const logoStyle = {
  color: '#5A824E',
  fontSize: '1.25rem',
  fontWeight: '700',
  margin: '0',
} as const

const contentStyle = {
  backgroundColor: '#ffffff',
  borderRadius: '0.75rem',
  padding: '2rem',
  margin: '0 1rem',
} as const

const headingStyle = {
  color: '#121A0F',
  fontSize: '1.25rem',
  fontWeight: '700',
  margin: '0 0 1rem 0',
} as const

const textStyle = {
  color: '#5a6657',
  fontSize: '0.875rem',
  lineHeight: '1.6',
  margin: '0 0 1rem 0',
} as const

const buttonGroupStyle = {
  textAlign: 'center' as const,
  margin: '1.5rem 0 1rem 0',
} as const

const secondaryButtonGroupStyle = {
  textAlign: 'center' as const,
  margin: '0 0 0.5rem 0',
} as const

const primaryButtonStyle = {
  backgroundColor: '#5A824E',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '0.875rem',
  fontWeight: '600',
  padding: '0.75rem 2rem',
  borderRadius: '0 0.625rem 0 0.625rem',
  textDecoration: 'none',
} as const

const secondaryButtonStyle = {
  backgroundColor: '#f7f9f6',
  color: '#5a6657',
  display: 'inline-block',
  fontSize: '0.8125rem',
  fontWeight: '500',
  padding: '0.5rem 1rem',
  borderRadius: '0.375rem',
  textDecoration: 'none',
  border: '1px solid #d4e0d0',
} as const

const tertiaryButtonStyle = {
  color: '#8a9987',
  display: 'inline-block',
  fontSize: '0.8125rem',
  fontWeight: '500',
  padding: '0.5rem 1rem',
  textDecoration: 'underline',
} as const

const spacerStyle = {
  display: 'inline',
  margin: '0',
  padding: '0',
  fontSize: '0.25rem',
} as const

const hrStyle = {
  borderColor: '#e8f0e6',
  margin: '1.5rem 1rem',
} as const

const footerStyle = {
  padding: '0 2rem 1rem',
  textAlign: 'center' as const,
} as const

const footerTextStyle = {
  color: '#8a9987',
  fontSize: '0.75rem',
  margin: '0',
} as const
