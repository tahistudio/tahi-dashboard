/**
 * <InvoiceOverdueEmail> — sent when an invoice has slipped past its due
 * date. Warning banner + pay-now CTA in warning orange.
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
  PrimaryButton,
  emailBodyStyle,
} from './_components'

interface InvoiceOverdueEmailProps {
  clientName: string
  invoiceId: string
  amountFormatted: string
  currency: string
  dueDate: string
  daysOverdue: number
  dashboardUrl: string
  paymentUrl?: string
}

export function InvoiceOverdueEmail({
  clientName,
  invoiceId,
  amountFormatted,
  currency,
  dueDate,
  daysOverdue,
  dashboardUrl,
  paymentUrl,
}: InvoiceOverdueEmailProps) {
  const invoiceUrl = `${dashboardUrl}/invoices`
  const displayId = invoiceId.slice(0, 8).toUpperCase()
  const firstName = clientName.split(' ')[0] ?? clientName
  const dayWord = daysOverdue === 1 ? 'day' : 'days'

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
              <DetailRow label="Invoice ID" value={displayId} mono />
              <DetailRow label="Original due date" value={dueDate} />
              <DetailRow label="Days overdue" value={String(daysOverdue)} />
            </DetailCard>

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
