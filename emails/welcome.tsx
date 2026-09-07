/**
 * <WelcomeEmail>: sent on client onboarding. Sets the tone for the
 * relationship: warm, brief, with a single clear CTA into the portal.
 *
 * That CTA is an invite link now, not a bare portal URL (see
 * app/api/admin/clients/[id]/welcome-email/route.ts), which means it is bound
 * to one address and it expires. Pass `boundEmail` and `expiresAt` whenever the
 * link carries a token so the email can say so plainly: a click after the
 * expiry, or from a different account, otherwise reads as the product being
 * broken rather than the link being spent.
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
  LedgerRow,
  LedgerRows,
  PrimaryButton,
  Step,
  Steps,
} from './_components'

interface WelcomeEmailProps {
  contactName: string
  orgName: string
  dashboardUrl: string
  /** The address the link is bound to. Shown so a mismatch is self-diagnosing. */
  boundEmail?: string | null
  /** ISO timestamp. Rendered as a plain date when present. */
  expiresAt?: string | null
}

function formatExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const features: { title: string; body: string }[] = [
  { title: 'Submit and track requests', body: 'Brief us on a piece of work and watch it move through review, in progress, and delivered.' },
  { title: 'Stay in the loop', body: 'Updates land in your inbox and on the portal so nothing slips through the cracks.' },
  { title: 'Pay invoices in a click', body: 'Stripe powered checkout, receipts, and a full invoice history in one tab.' },
  { title: 'Message the team directly', body: 'Per request threads keep the conversation tied to the work, not buried in email.' },
]

export function WelcomeEmail({
  contactName,
  orgName,
  dashboardUrl,
  boundEmail,
  expiresAt,
}: WelcomeEmailProps) {
  const firstName = contactName.split(' ')[0] ?? contactName
  const expiry = formatExpiry(expiresAt)
  const bound = boundEmail?.trim() || null

  return (
    <EmailDocument preview={`Welcome to Tahi Studio, ${firstName}`}>
      <EmailCard>
        <EmailNav label="Welcome aboard" />
        <EmailHero>
          <EmailKicker>Hello</EmailKicker>
          <EmailHeading>Kia ora {firstName}, your portal is ready.</EmailHeading>
          <EmailParagraph>
            We are delighted to have {orgName} as part of the Tahi family. Your portal is live
            and ready, and the team is briefed on the relationship. Here is what you can do
            from day one.
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <Steps>
            {features.map((f, i) => (
              <Step key={f.title} n={i + 1} title={f.title} detail={f.body} />
            ))}
          </Steps>

          <Buttons>
            <PrimaryButton href={dashboardUrl}>Open your portal</PrimaryButton>
          </Buttons>

          {bound || expiry ? (
            <LedgerRows>
              <LedgerRow label="Workspace" value={orgName} />
              {bound ? <LedgerRow label="Invite sent to" value={bound} /> : null}
              {expiry ? <LedgerRow label="Link valid until" value={expiry} /> : null}
            </LedgerRows>
          ) : null}

          {bound ? (
            <EmailParagraph variant="small">
              This link only works for {bound}, so forwarding it will not give anyone else
              access. If it has stopped working, reply here and we will send a fresh one.
            </EmailParagraph>
          ) : null}

          <EmailParagraph variant="small">
            Got a question or need a hand getting set up? Just reply to this email or send us
            a message from the dashboard. We are here.
          </EmailParagraph>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" recipientEmail={bound} />
    </EmailDocument>
  )
}

export default WelcomeEmail
