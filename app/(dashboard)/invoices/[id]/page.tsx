import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { InvoiceDetail } from './invoice-detail'
import { PortalInvoiceDetail } from '@/components/tahi/portal/invoices/portal-invoice-detail'

export const metadata = { title: 'Invoice - Tahi Dashboard' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function InvoiceDetailPage({ params }: Props) {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')

  const { id } = await params
  // Passed down as a prop: the cookie is browser wide, the client-side
  // impersonation store is per tab, and the pay link must obey the cookie.
  const previewing = isPreviewingClient

  // The client's invoice: line items, How to pay, a way to ask about any
  // line, and no Source badge. The shared detail below stays the studio's.
  if (!isAdmin || previewing) return <PortalInvoiceDetail invoiceId={id} preview={previewing} />

  return <InvoiceDetail invoiceId={id} isAdmin={isAdmin} />
}
