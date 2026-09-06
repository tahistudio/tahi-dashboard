/**
 * <InvoiceOverdueEmail>: sent when an invoice has slipped past its due date.
 * Warning banner plus a pay-now CTA in warning orange.
 *
 * When there is no pay page (a Xero-rail invoice still waiting on approval in
 * Xero) the CTA falls back to the portal and a How to pay block carries the
 * bank details and the reference, so a chase email always tells the client how
 * to actually clear the bill. See lib/invoice-how-to-pay.ts.
 */
import { Body, Head, Html, Preview } from '@react-email/components'
import {
  DetailCard,
  DetailRow,
  EmailBanner,
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
  emailBodyStyle,
} from './_components'
import { hasBankDestination, type InvoiceHowToPay } from '@/lib/invoice-how-to-pay'
import { invoiceReference } from '@/lib/invoice-billing'

interface InvoiceOverdueEmailProps {
  clientName: string
  invoiceId: string
  /**
   * invoices.number, the real invoice number, when the row carries one. It is
   * what the client quotes on a transfer and what Xero calls the same bill, so
   * the email has to print it rather than a UUID fragment. Absent or null falls
   * back to the short id, exactly as before migration 0096.
   */
  invoiceNumber?: string | null
  amountFormatted: string
  currency: string
  dueDate: string
  daysOverdue: number
  dashboardUrl: string
  /** Hosted pay page (Stripe, or Xero's online invoice), when one exists. */
  paymentUrl?: string
  /** Bank transfer details, for a Xero-rail invoice with no pay page yet. */
  howToPay?: InvoiceHowToPay
}

export function InvoiceOverdueEmail({
  clientName,
  invoiceId,
  invoiceNumber,
  amountFormatted,
  currency,
  dueDate,
  daysOverdue,
  dashboardUrl,
  paymentUrl,
  howToPay,
}: InvoiceOverdueEmailProps) {
  const invoiceUrl = `${dashboardUrl}/invoices`
  const displayId = invoiceReference(invoiceId, invoiceNumber)
  const firstName = clientName.split(' ')[0] ?? clientName
  const dayWord = daysOverdue === 1 ? 'day' : 'days'
  // A chase with no way to pay is just a nag. When neither rail has issued a
  // pay page, the bank details take the CTA's job.
  const showTransfer = !paymentUrl && hasBankDestination(howToPay)

  return (
    <Html>
      <Head />
      <Preview>{`Reminder: invoice ${displayId} is ${daysOverdue} ${dayWord} overdue`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Friendly payment reminder" />

          <EmailCard>
            <EmailBanner kind="warning">Payment overdue</EmailBanner>
            <EmailEyebrow>Invoice {displayId}</EmailEyebrow>
            <EmailHeading>
              A small <span style={{ color: '#5A824E' }}>nudge</span> on this invoice
            </EmailHeading>

            <EmailParagraph>
              Hi {firstName}, your invoice from Tahi Studio was due on {dueDate} and is now
              {' '}{daysOverdue} {dayWord} past due. If you have already paid, please ignore
              this. Banks can take a couple of days to reconcile.
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Amount due" value={`${amountFormatted} ${currency}`} hero />
              <DetailRow label={invoiceNumber ? 'Invoice number' : 'Invoice ID'} value={displayId} mono />
              <DetailRow label="Original due date" value={dueDate} />
              <DetailRow label="Days overdue" value={String(daysOverdue)} />
            </DetailCard>

            {showTransfer && howToPay && <HowToPayBlock howToPay={howToPay} />}

            <PrimaryButton href={paymentUrl ?? invoiceUrl} variant="warning">
              {paymentUrl ? 'Pay now' : 'View invoice'}
            </PrimaryButton>

            <EmailFootnote>
              If anything is blocking payment, reply to this email and we will work it out
              together. We would rather hear from you than chase silently.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default InvoiceOverdueEmail
