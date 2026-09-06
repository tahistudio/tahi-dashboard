/**
 * <ProjectEnquiryEmail> — internal notification sent to business@tahi.studio
 * when a self-serve visitor submits a one-off project enquiry from the
 * onboarding chooser. Studio Ledger, team mail: ledger rows for the contact
 * details, a block quote of the brief.
 */
import { Body, Head, Html, Preview } from '@react-email/components'
import {
  BlockQuote,
  EmailBody,
  EmailCard,
  EmailFooter,
  EmailHeading,
  EmailHero,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  EmailShell,
  LedgerRow,
  LedgerRows,
  emailBodyStyle,
} from './_components'

export interface ProjectEnquiryEmailProps {
  contactName: string
  contactEmail: string
  company: string
  website?: string | null
  brief: string
  budget?: string | null
  disciplines?: string | null
}

export function ProjectEnquiryEmail({
  contactName,
  contactEmail,
  company,
  website,
  brief,
  budget,
  disciplines,
}: ProjectEnquiryEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`New project enquiry from ${contactName} at ${company}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailCard>
            <EmailNav label="Enquiry" />
            <EmailHero>
              <EmailKicker tone="neutral">New project enquiry</EmailKicker>
              <EmailHeading>{`${contactName} at ${company} wants to talk.`}</EmailHeading>
              <EmailParagraph variant="muted">
                From the onboarding chooser, a one-off project lead.
              </EmailParagraph>
            </EmailHero>
            <EmailBody>
              <LedgerRows>
                <LedgerRow label="From" value={`${contactName} (${contactEmail})`} tone="brand" />
                <LedgerRow label="Company" value={company} />
                {website ? <LedgerRow label="Website" value={website} /> : null}
                {budget ? <LedgerRow label="Rough budget" value={budget} /> : null}
                {disciplines ? <LedgerRow label="They want" value={disciplines} /> : null}
              </LedgerRows>

              <EmailKicker tone="neutral">What they are after</EmailKicker>
              <BlockQuote>{brief}</BlockQuote>
            </EmailBody>
          </EmailCard>

          <EmailFooter audience="team" />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default ProjectEnquiryEmail
