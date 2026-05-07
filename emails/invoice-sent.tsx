/**
 * <InvoiceSentEmail> — sent to the client when a new invoice is issued.
 * Stripe payment URL takes priority over a generic dashboard link.
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
  emailBodyStyle,
} from './_components'

interface InvoiceSentEmailProps {
  clientName: string
  invoiceId: string
  amountFormatted: string
  currency: string
  dueDate?: string
  notes?: string
  dashboardUrl: string
  paymentUrl?: string
}

export function InvoiceSentEmail({
  clientName,
  invoiceId,
  amountFormatted,
  currency,
  dueDate,
  notes,
  dashboardUrl,
  paymentUrl,
}: InvoiceSentEmailProps) {
  const invoiceUrl = `${dashboardUrl}/invoices`
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
              Hi {firstName}, here is the latest invoice from Tahi Studio. The full breakdown
              is on the dashboard, and you can pay directly from the button below.
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
