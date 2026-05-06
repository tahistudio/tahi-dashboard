import {
  Body, Container, Head, Heading, Html, Link, Preview, Section, Text, Hr,
} from '@react-email/components'

interface ContractSignEmailProps {
  signerName: string
  signerRole: string                // 'tahi' | 'client' | 'other'
  contractName: string
  contractType: string              // 'sow' | 'msa' | etc
  signUrl: string
  fromName: string                  // who is sending — e.g. "Liam Miller"
  customMessage?: string | null
}

const TYPE_LABEL: Record<string, string> = {
  nda: 'Non-disclosure agreement',
  sla: 'Service-level agreement',
  msa: 'Master services agreement',
  sow: 'Statement of work',
  mou: 'Memorandum of understanding',
  other: 'contract',
}

export function ContractSignEmail({
  signerName, signerRole, contractName, contractType, signUrl, fromName, customMessage,
}: ContractSignEmailProps) {
  const isInternal = signerRole === 'tahi'
  const typeLabel = TYPE_LABEL[contractType] ?? 'contract'

  return (
    <Html>
      <Head />
      <Preview>{`${fromName} has shared a ${typeLabel} for your signature`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Heading style={logoStyle}>Tahi Studio</Heading>
          </Section>

          <Section style={contentStyle}>
            <Heading as="h2" style={headingStyle}>
              {isInternal ? 'Your signature is needed' : 'Ready for your signature'}
            </Heading>
            <Text style={textStyle}>Hi {signerName.split(' ')[0]},</Text>
            <Text style={textStyle}>
              {isInternal
                ? `Please sign the ${typeLabel.toLowerCase()} below.`
                : `${fromName} has shared a ${typeLabel.toLowerCase()} for your review and signature.`}
            </Text>

            <Section style={cardStyle}>
              <Text style={cardLabel}>{TYPE_LABEL[contractType]?.toUpperCase() ?? 'CONTRACT'}</Text>
              <Text style={cardTitle}>{contractName}</Text>
            </Section>

            {customMessage && (
              <Section style={messageStyle}>
                <Text style={messageLabel}>Message from {fromName}</Text>
                <Text style={messageBody}>{customMessage}</Text>
              </Section>
            )}

            <Section style={buttonGroupStyle}>
              <Link href={signUrl} style={primaryButtonStyle}>
                Review &amp; sign
              </Link>
            </Section>

            <Text style={footnoteStyle}>
              Each signature is anchored to a tamper-evident SHA-256 chain. Your IP is hashed,
              never stored in plain text. The link is unique to you.
            </Text>
          </Section>

          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>Tahi Studio · business@tahi.studio</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default ContractSignEmail

const bodyStyle = { backgroundColor: '#f5f7f5', fontFamily: 'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', margin: '0', padding: '0' } as const
const containerStyle = { maxWidth: '560px', margin: '0 auto', padding: '2rem 0' } as const
const headerStyle = { padding: '1.5rem 2rem', textAlign: 'center' as const } as const
const logoStyle = { color: '#5A824E', fontSize: '1.25rem', fontWeight: '700', margin: '0' } as const
const contentStyle = { backgroundColor: '#ffffff', borderRadius: '0.75rem', padding: '2rem', margin: '0 1rem' } as const
const headingStyle = { color: '#121A0F', fontSize: '1.25rem', fontWeight: '700', margin: '0 0 1rem 0' } as const
const textStyle = { color: '#5a6657', fontSize: '0.875rem', lineHeight: '1.6', margin: '0 0 1rem 0' } as const
const cardStyle = { backgroundColor: '#f7f9f6', border: '1px solid #e8f0e6', borderRadius: '0.625rem', padding: '1rem 1.25rem', margin: '1.25rem 0' } as const
const cardLabel = { color: '#8a9987', fontSize: '0.6875rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' as const, margin: '0 0 0.25rem 0' } as const
const cardTitle = { color: '#121A0F', fontSize: '1rem', fontWeight: '700', margin: '0' } as const
const messageStyle = { backgroundColor: '#fdfefd', border: '1px dashed #d4e0d0', borderRadius: '0.5rem', padding: '0.875rem 1rem', margin: '1rem 0' } as const
const messageLabel = { color: '#8a9987', fontSize: '0.6875rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' as const, margin: '0 0 0.375rem 0' } as const
const messageBody = { color: '#1f2c1a', fontSize: '0.875rem', lineHeight: '1.55', margin: '0', whiteSpace: 'pre-wrap' as const } as const
const buttonGroupStyle = { textAlign: 'center' as const, margin: '1.5rem 0 1rem 0' } as const
const primaryButtonStyle = { backgroundColor: '#5A824E', color: '#ffffff', display: 'inline-block', fontSize: '0.875rem', fontWeight: '700', padding: '0.75rem 2rem', borderRadius: '0 16px 0 16px', textDecoration: 'none' } as const
const footnoteStyle = { color: '#8a9987', fontSize: '0.75rem', lineHeight: '1.5', margin: '1rem 0 0 0' } as const
const hrStyle = { borderColor: '#e8f0e6', margin: '1.5rem 1rem' } as const
const footerStyle = { padding: '0 2rem 1rem', textAlign: 'center' as const } as const
const footerTextStyle = { color: '#8a9987', fontSize: '0.75rem', margin: '0' } as const
