/**
 * <ReviewRequestEmail> - testimonial outreach: ask a happy client whether
 * they would be open to leaving a review. Three answer paths embedded as
 * tracked links: yes / defer / no.
 */
import {
  Buttons,
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHero,
  EmailKicker,
  EmailHeading,
  EmailNav,
  EmailParagraph,
  PrimaryButton,
  SecondaryLink,
} from './_components'

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
  const firstName = clientName.split(' ')[0] ?? clientName

  return (
    <EmailDocument preview={`We would love your feedback, ${firstName}`}>
      <EmailCard>
        <EmailNav label="A quick favour" />
        <EmailHero>
          <EmailKicker>How was it?</EmailKicker>
          <EmailHeading>Would you share a kind word?</EmailHeading>
          <EmailParagraph>
            Hi {firstName}, we have loved working with {orgName} and would really appreciate
            hearing about your experience. A short review helps us improve and helps other
            businesses decide if Tahi is right for them. It takes a couple of minutes. Are you
            open to it?
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <Buttons>
            <PrimaryButton href={yesUrl}>Yes, happy to</PrimaryButton>
            <SecondaryLink href={deferUrl}>Not right now</SecondaryLink>
            <SecondaryLink href={noUrl}>No thanks</SecondaryLink>
          </Buttons>

          <EmailParagraph variant="small">
            No pressure either way. We will not ask again unless you tell us to.
          </EmailParagraph>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}

export default ReviewRequestEmail
