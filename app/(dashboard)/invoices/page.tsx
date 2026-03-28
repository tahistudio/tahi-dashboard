import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { InvoiceList } from './invoice-list'

export const metadata = { title: 'Invoices -- Tahi Dashboard' }

export default async function InvoicesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return <InvoiceList isAdmin={isAdmin} />
}
