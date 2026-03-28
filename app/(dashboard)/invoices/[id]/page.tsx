import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { InvoiceDetail } from './invoice-detail'

export const metadata = { title: 'Invoice -- Tahi Dashboard' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function InvoiceDetailPage({ params }: Props) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const { id } = await params
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return <InvoiceDetail invoiceId={id} isAdmin={isAdmin} />
}
