/**
 * <InvoiceOverdueEmail>: sent when an invoice has slipped past its due date.
 * Danger kicker plus a note box, and a pay-now CTA.
 *
 * When there is no pay page (a Xero-rail invoice still waiting on approval in
 * Xero) the CTA falls back to the portal and a How to pay block carries the
 * bank details and the reference, so a chase email always tells the client how
 * to actually clear the bill. See lib/invoice-how-to-pay.ts.
 */
import {
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailFootnote,
  EmailHero,
  EmailHeading,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  HowToPayBlock,
  LedgerRow,
  LedgerRows,
  NoteBox,
  PrimaryButton,
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
    <EmailDocument preview={`Reminder: invoice ${displayId} is ${daysOverdue} ${dayWord} overdue`}>
      <EmailCard>
        <EmailNav label={`Invoice ${displayId}`} />
        <EmailHero>
          <EmailKicker tone="danger">Payment overdue</EmailKicker>
          <EmailHeading>Kia ora {firstName}, a small nudge on this invoice.</EmailHeading>
          <EmailParagraph>
            Your invoice from Tahi Studio was due on {dueDate} and is now {daysOverdue} {dayWord} past
            due. If you have already paid, please ignore this. Banks can take a couple of days to
            reconcile.
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <NoteBox tone="danger" title="Payment overdue">
            {daysOverdue} {dayWord} past the due date of {dueDate}.
          </NoteBox>

          <LedgerRows>
            <LedgerRow label="Amount due" value={`${amountFormatted} ${currency}`} tone="danger" />
            <LedgerRow label={invoiceNumber ? 'Invoice number' : 'Invoice ID'} value={displayId} mono />
            <LedgerRow label="Original due date" value={dueDate} />
            <LedgerRow label="Days overdue" value={String(daysOverdue)} />
          </LedgerRows>

          {showTransfer && howToPay && <HowToPayBlock howToPay={howToPay} />}

          <PrimaryButton href={paymentUrl ?? invoiceUrl}>{paymentUrl ? 'Pay now' : 'View invoice'}</PrimaryButton>

          <EmailFootnote>
            If anything is blocking payment, reply to this email and we will work it out together. We
            would rather hear from you than chase silently.
          </EmailFootnote>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}

export default InvoiceOverdueEmail
