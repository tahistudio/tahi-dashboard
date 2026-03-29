import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { AdminServicesContent, PortalServicesContent } from './services-content'

export const metadata = { title: 'Services - Tahi Dashboard' }

export default async function ServicesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return isAdmin ? <AdminServicesContent /> : <PortalServicesContent />
}
