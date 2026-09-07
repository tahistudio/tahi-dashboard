/**
 * <ProjectEnquiryEmail>: internal notification sent to business@tahi.studio
 * when a self-serve visitor submits a one-off project enquiry from the
 * onboarding chooser. Studio Ledger, team mail: ledger rows for the contact
 * details, a block quote of the brief, one button into the lead record.
 */
import {
  BlockQuote,
  Buttons,
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHeading,
  EmailHero,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  LedgerRow,
  LedgerRows,
  PrimaryButton,
} from './_components'

export interface ProjectEnquiryEmailProps {
  contactName: string
  contactEmail: string
  company: string
  website?: string | null
  brief: string
  budget?: string | null
  disciplines?: string | null
  /** Absolute URL of the lead record the enquiry created. */
  leadUrl?: string | null
}

export function ProjectEnquiryEmail({
  contactName,
  contactEmail,
  company,
  website,
  brief,
  budget,
  disciplines,
  leadUrl,
}: ProjectEnquiryEmailProps) {
  return (
    <EmailDocument preview={`New project enquiry from ${contactName} at ${company}`}>
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

          {leadUrl ? (
            <Buttons>
              <PrimaryButton href={leadUrl}>Open the lead</PrimaryButton>
            </Buttons>
          ) : null}
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="team" />
    </EmailDocument>
  )
}

export default ProjectEnquiryEmail
