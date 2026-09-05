import { getServerAuth } from '@/lib/server-auth'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { InvoiceDetail } from './invoice-detail'
import { PortalInvoiceDetail } from '@/components/tahi/portal/invoices/portal-invoice-detail'

export const metadata = { title: 'Invoice - Tahi Dashboard' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function InvoiceDetailPage({ params }: Props) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const { id } = await params
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  const previewing = isAdmin && Boolean((await cookies()).get('tahi-impersonate-org')?.value)

  // The client's invoice: line items, How to pay, a way to ask about any
  // line, and no Source badge. The shared detail below stays the studio's.
  if (!isAdmin || previewing) return <PortalInvoiceDetail invoiceId={id} />

  return <InvoiceDetail invoiceId={id} isAdmin={isAdmin} />
}
