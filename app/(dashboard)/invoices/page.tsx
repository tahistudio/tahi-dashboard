import { getServerAuth } from '@/lib/server-auth'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { InvoiceList } from './invoice-list'
import { PortalInvoiceList } from '@/components/tahi/portal/invoices/portal-invoice-list'

export const metadata = { title: 'Invoices - Tahi Dashboard' }

export default async function InvoicesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // A Tahi login previewing the portal as a client (the impersonation cookie
  // makes the portal routes answer for that org) sees exactly what the client
  // sees, with every write control disabled. Same branch as /services.
  //
  // It is handed down as a prop rather than left to the client-side store: the
  // cookie is browser wide and the store is per tab, so a second tab would see
  // the client's real invoices with the live pay link enabled.
  const previewing = isAdmin && Boolean((await cookies()).get('tahi-impersonate-org')?.value)

  // The client audience has its own surface now: three-word statuses, their
  // own currency, How to pay, and no studio rail anywhere. The shared list
  // below stays the studio's.
  if (!isAdmin || previewing) return <PortalInvoiceList preview={previewing} />

  return <InvoiceList isAdmin={isAdmin} />
}
