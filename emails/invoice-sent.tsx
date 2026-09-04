/**
 * <InvoiceSentEmail> - sent to the client when an invoice is issued.
 *
 * Two links, and both have to work for the client who receives them:
 *   paymentUrl  Stripe's hosted invoice page. Present once the invoice has
 *               been finalised in Stripe, and it is the primary CTA.
 *   invoiceUrl  the portal invoice page (/invoices/<id>). Always present, and
 *               it is a CLIENT surface, not the admin one that used to 403
 *               everybody who clicked "View Invoice".
 */
import { Body, Head, Html, Preview } from '@react-email/components'
import {
  DetailCard,
  DetailRow,
  EmailCard,
  EmailEyebrow,
  EmailFooter,
  EmailFootnote,
  EmailHeader,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  PrimaryButton,
  SecondaryLink,
  emailBodyStyle,
} from './_components'

interface InvoiceSentEmailProps {
  clientName: string
  invoiceId: string
  amountFormatted: string
  currency: string
  dueDate?: string
  notes?: string
  /** Deep link to this invoice in the client's own portal. */
  invoiceUrl: string
  /** Stripe hosted invoice page, when the invoice has been finalised there. */
  paymentUrl?: string
}

export function InvoiceSentEmail({
  clientName,
  invoiceId,
  amountFormatted,
  currency,
  dueDate,
  notes,
  invoiceUrl,
  paymentUrl,
}: InvoiceSentEmailProps) {
  const displayId = invoiceId.slice(0, 8).toUpperCase()
  const firstName = clientName.split(' ')[0] ?? clientName

  return (
    <Html>
      <Head />
      <Preview>{`Invoice ${displayId} from Tahi Studio: ${amountFormatted} ${currency}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="A new invoice is ready" />

          <EmailCard>
            <EmailEyebrow>Invoice {displayId}</EmailEyebrow>
            <EmailHeading>
              Your <span style={{ color: '#5A824E' }}>invoice</span> is ready
            </EmailHeading>

            <EmailParagraph>
              Hi {firstName}, here is the latest invoice from Tahi Studio.
              {paymentUrl
                ? ' You can pay it straight from the button below, or open it in your portal for the full breakdown.'
                : ' Open it in your portal for the full breakdown.'}
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Amount due" value={`${amountFormatted} ${currency}`} hero />
              <DetailRow label="Invoice ID" value={displayId} mono />
              {dueDate && <DetailRow label="Due date" value={dueDate} />}
              {notes && <DetailRow label="Notes" value={notes} />}
            </DetailCard>

            <PrimaryButton href={paymentUrl ?? invoiceUrl}>
              {paymentUrl ? 'Pay invoice' : 'View invoice'}
            </PrimaryButton>

            {paymentUrl && (
              <SecondaryLink href={invoiceUrl}>View it in your portal</SecondaryLink>
            )}

            <EmailFootnote>
              Questions about a line item? Reply to this email and we will walk through it with you.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default InvoiceSentEmail
