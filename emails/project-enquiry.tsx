import type { CSSProperties } from 'react'
import { Html, Body, Container, Heading, Text, Hr, Section } from '@react-email/components'

export interface ProjectEnquiryEmailProps {
  contactName: string
  contactEmail: string
  company: string
  website?: string | null
  brief: string
  budget?: string | null
  disciplines?: string | null
}

/**
 * Internal notification sent to business@tahi.studio when a self-serve visitor
 * submits a one-off project enquiry from the onboarding chooser.
 */
export default function ProjectEnquiryEmail(props: ProjectEnquiryEmailProps) {
  const label: CSSProperties = { margin: '0', color: '#5a6657', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const value: CSSProperties = { margin: '2px 0 14px', color: '#121A0F', fontSize: '15px', lineHeight: '1.5' }
  return (
    <Html>
      <Body style={{ backgroundColor: '#f7f9f6', fontFamily: 'Manrope, Arial, sans-serif', padding: '24px' }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '0 16px 0 16px', padding: '28px', border: '1px solid #d4e0d0' }}>
          <Heading style={{ margin: '0 0 4px', color: '#121A0F', fontSize: '20px' }}>New project enquiry</Heading>
          <Text style={{ margin: '0 0 18px', color: '#5a6657', fontSize: '14px' }}>From the onboarding chooser, a one-off project lead.</Text>

          <Section>
            <Text style={label}>From</Text>
            <Text style={value}>{props.contactName}{props.contactEmail ? ` (${props.contactEmail})` : ''}</Text>

            <Text style={label}>Company</Text>
            <Text style={value}>{props.company}</Text>

            {props.website ? (<><Text style={label}>Website</Text><Text style={value}>{props.website}</Text></>) : null}
            {props.budget ? (<><Text style={label}>Rough budget</Text><Text style={value}>{props.budget}</Text></>) : null}
            {props.disciplines ? (<><Text style={label}>They want</Text><Text style={value}>{props.disciplines}</Text></>) : null}
          </Section>

          <Hr style={{ borderColor: '#e8f0e6', margin: '8px 0 16px' }} />

          <Text style={label}>What they are after</Text>
          <Text style={{ ...value, whiteSpace: 'pre-wrap' }}>{props.brief}</Text>
        </Container>
      </Body>
    </Html>
  )
}
