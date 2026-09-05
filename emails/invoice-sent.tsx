/**
 * <InvoiceSentEmail> - sent to the client when an invoice is issued.
 *
 * Two links, and both have to work for the client who receives them:
 *   paymentUrl  the hosted pay page: Stripe's, or Xero's own online invoice
 *               once Liam has approved it there. Present when the client can
 *               pay with one click, and it is the primary CTA.
 *   invoiceUrl  the portal invoice page (/invoices/<id>). Always present, and
 *               it is a CLIENT surface, not the admin one that used to 403
 *               everybody who clicked "View Invoice".
 *
 * And one block for the case where neither rail has issued a pay page yet,
 * which is where every Xero-rail invoice starts (the push holds it at DRAFT
 * until it is approved by hand): `howToPay` carries the studio's bank details
 * and the reference to quote, so the client can act on the bill instead of
 * waiting for a link that has not been issued. See lib/invoice-how-to-pay.ts.
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
  HowToPayBlock,
  PrimaryButton,
  SecondaryLink,
  emailBodyStyle,
} from './_components'
import { hasBankDestination, type InvoiceHowToPay } from '@/lib/invoice-how-to-pay'

interface InvoiceSentEmailProps {
  clientName: string
  invoiceId: string
  amountFormatted: string
  currency: string
  dueDate?: string
  notes?: string
  /** Deep link to this invoice in the client's own portal. */
  invoiceUrl: string
  /** Hosted pay page (Stripe, or Xero's online invoice), when one exists. */
  paymentUrl?: string
  /** Bank transfer details, for a Xero-rail invoice with no pay page yet. */
  howToPay?: InvoiceHowToPay
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
  howToPay,
}: InvoiceSentEmailProps) {
  const displayId = invoiceId.slice(0, 8).toUpperCase()
  const firstName = clientName.split(' ')[0] ?? clientName
  // Three states, in order of what the client can do: pay it in one click,
  // pay it by transfer, or open it and wait for us. Only one is ever shown.
  const showTransfer = !paymentUrl && hasBankDestination(howToPay)

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
                : showTransfer
                  ? ' Our bank details are below, and you can open it in your portal for the full breakdown.'
                  : ' Open it in your portal for the full breakdown.'}
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Amount due" value={`${amountFormatted} ${currency}`} hero />
              <DetailRow label="Invoice ID" value={displayId} mono />
              {dueDate && <DetailRow label="Due date" value={dueDate} />}
              {notes && <DetailRow label="Notes" value={notes} />}
            </DetailCard>

            {showTransfer && howToPay && <HowToPayBlock howToPay={howToPay} />}

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
