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

interface WelcomeEmailProps {
  contactName: string
  orgName: string
  dashboardUrl: string
}

export function WelcomeEmail({
  contactName,
  orgName,
  dashboardUrl,
}: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Tahi Studio, {contactName}!</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Heading style={logoStyle}>Tahi Studio</Heading>
          </Section>

          <Section style={contentStyle}>
            <Section style={leafAccentStyle}>
              <Text style={leafIconStyle}>&#127807;</Text>
            </Section>

            <Heading as="h2" style={headingStyle}>
              Welcome to Tahi Studio
            </Heading>

            <Text style={textStyle}>
              Hi {contactName}, welcome aboard! We are excited to have {orgName} as
              part of the Tahi Studio family.
            </Text>

            <Text style={textStyle}>
              Your dashboard is ready. Here is what you can do from your portal:
            </Text>

            <Section style={featureListStyle}>
              <Text style={featureItemStyle}>
                <Text style={bulletStyle}>&#9679;</Text> Submit and manage design or development requests
              </Text>
              <Text style={featureItemStyle}>
                <Text style={bulletStyle}>&#9679;</Text> Track progress on your active projects in real time
              </Text>
              <Text style={featureItemStyle}>
                <Text style={bulletStyle}>&#9679;</Text> View and pay invoices directly from the portal
              </Text>
              <Text style={featureItemStyle}>
                <Text style={bulletStyle}>&#9679;</Text> Message our team and share files securely
              </Text>
            </Section>

            <Section style={buttonSectionStyle}>
              <Link href={dashboardUrl} style={buttonStyle}>
                Get Started
              </Link>
            </Section>

            <Text style={signoffStyle}>
              If you have any questions, just reply to this email or send us a message
              through the dashboard. We are here to help.
            </Text>
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

export default WelcomeEmail

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

const leafAccentStyle = {
  textAlign: 'center' as const,
  marginBottom: '0.5rem',
} as const

const leafIconStyle = {
  fontSize: '2rem',
  margin: '0',
} as const

const headingStyle = {
  color: '#121A0F',
  fontSize: '1.25rem',
  fontWeight: '700',
  margin: '0 0 1rem 0',
  textAlign: 'center' as const,
} as const

const textStyle = {
  color: '#5a6657',
  fontSize: '0.875rem',
  lineHeight: '1.5',
  margin: '0 0 1rem 0',
} as const

const featureListStyle = {
  backgroundColor: '#f0f7ee',
  borderRadius: '0.5rem',
  padding: '1rem 1.25rem',
  margin: '0 0 1.5rem 0',
} as const

const featureItemStyle = {
  color: '#121A0F',
  fontSize: '0.875rem',
  lineHeight: '1.6',
  margin: '0.25rem 0',
} as const

const bulletStyle = {
  color: '#5A824E',
  fontSize: '0.5rem',
  display: 'inline' as const,
  marginRight: '0.5rem',
} as const

const buttonSectionStyle = {
  textAlign: 'center' as const,
  margin: '0 0 1.5rem 0',
} as const

const buttonStyle = {
  backgroundColor: '#5A824E',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '0.875rem',
  fontWeight: '600',
  padding: '0.75rem 2rem',
  borderRadius: '0 0.625rem 0 0.625rem',
  textDecoration: 'none',
} as const

const signoffStyle = {
  color: '#8a9987',
  fontSize: '0.8125rem',
  lineHeight: '1.5',
  margin: '0',
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
