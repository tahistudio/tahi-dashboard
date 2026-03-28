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
      <Preview>Your request has been delivered: {requestTitle}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Heading style={logoStyle}>Tahi Studio</Heading>
          </Section>

          <Section style={contentStyle}>
            <Heading as="h2" style={headingStyle}>
              Request Delivered
            </Heading>

            <Text style={textStyle}>
              Your request has been completed and delivered.
            </Text>

            <Section style={detailsBoxStyle}>
              <Text style={detailLabelStyle}>Title</Text>
              <Text style={detailValueStyle}>{requestTitle}</Text>

              <Text style={detailLabelStyle}>Client</Text>
              <Text style={detailValueStyle}>{clientName}</Text>

              <Text style={detailLabelStyle}>Delivered</Text>
              <Text style={detailValueStyle}>{deliveredAt}</Text>
            </Section>

            <Text style={textStyle}>
              Please review the deliverables and let us know if any revisions are needed.
            </Text>

            <Section style={buttonSectionStyle}>
              <Link href={requestUrl} style={buttonStyle}>
                View Request
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

export default RequestDeliveredEmail

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
  lineHeight: '1.5',
  margin: '0 0 1.5rem 0',
} as const

const detailsBoxStyle = {
  backgroundColor: '#f7f9f6',
  borderRadius: '0.5rem',
  padding: '1rem 1.25rem',
  margin: '0 0 1.5rem 0',
} as const

const detailLabelStyle = {
  color: '#8a9987',
  fontSize: '0.75rem',
  fontWeight: '600',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  margin: '0.75rem 0 0.125rem 0',
} as const

const detailValueStyle = {
  color: '#121A0F',
  fontSize: '0.875rem',
  fontWeight: '500',
  margin: '0',
} as const

const buttonSectionStyle = {
  textAlign: 'center' as const,
} as const

const buttonStyle = {
  backgroundColor: '#5A824E',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '0.875rem',
  fontWeight: '600',
  padding: '0.625rem 1.5rem',
  borderRadius: '0 0.625rem 0 0.625rem',
  textDecoration: 'none',
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
