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

interface InvoiceOverdueEmailProps {
  clientName: string
  invoiceId: string
  amountFormatted: string
  currency: string
  dueDate: string
  daysOverdue: number
  dashboardUrl: string
  paymentUrl?: string
}

export function InvoiceOverdueEmail({
  clientName,
  invoiceId,
  amountFormatted,
  currency,
  dueDate,
  daysOverdue,
  dashboardUrl,
  paymentUrl,
}: InvoiceOverdueEmailProps) {
  const invoiceUrl = `${dashboardUrl}/invoices`
  const displayId = invoiceId.slice(0, 8).toUpperCase()

  return (
    <Html>
      <Head />
      <Preview>Invoice #{displayId} is overdue - {amountFormatted} {currency}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Heading style={logoStyle}>Tahi Studio</Heading>
          </Section>

          <Section style={contentStyle}>
            <Section style={warningBannerStyle}>
              <Text style={warningTextStyle}>Payment Overdue</Text>
            </Section>

            <Heading as="h2" style={headingStyle}>
              Invoice #{displayId} is overdue
            </Heading>

            <Text style={textStyle}>
              Hi {clientName}, your invoice from Tahi Studio was due on {dueDate} and
              is now {daysOverdue} {daysOverdue === 1 ? 'day' : 'days'} past due.
            </Text>

            <Section style={detailsBoxStyle}>
              <Text style={detailLabelStyle}>Invoice ID</Text>
              <Text style={detailValueStyle}>{displayId}</Text>

              <Text style={detailLabelStyle}>Amount Due</Text>
              <Text style={amountStyle}>{amountFormatted} {currency}</Text>

              <Text style={detailLabelStyle}>Due Date</Text>
              <Text style={overdueValueStyle}>{dueDate}</Text>

              <Text style={detailLabelStyle}>Days Overdue</Text>
              <Text style={overdueValueStyle}>{daysOverdue}</Text>
            </Section>

            <Text style={textStyle}>
              Please arrange payment at your earliest convenience. If you have already
              paid, please disregard this reminder.
            </Text>

            <Section style={buttonSectionStyle}>
              {paymentUrl ? (
                <Link href={paymentUrl} style={buttonStyle}>
                  Pay Now
                </Link>
              ) : (
                <Link href={invoiceUrl} style={buttonStyle}>
                  View Invoice
                </Link>
              )}
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

export default InvoiceOverdueEmail

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

const warningBannerStyle = {
  backgroundColor: '#fff7ed',
  borderRadius: '0.375rem',
  padding: '0.5rem 1rem',
  marginBottom: '1rem',
  textAlign: 'center' as const,
} as const

const warningTextStyle = {
  color: '#fb923c',
  fontSize: '0.75rem',
  fontWeight: '700',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  margin: '0',
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

const amountStyle = {
  color: '#121A0F',
  fontSize: '1.25rem',
  fontWeight: '700',
  margin: '0',
} as const

const overdueValueStyle = {
  color: '#f87171',
  fontSize: '0.875rem',
  fontWeight: '600',
  margin: '0',
} as const

const buttonSectionStyle = {
  textAlign: 'center' as const,
} as const

const buttonStyle = {
  backgroundColor: '#fb923c',
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
