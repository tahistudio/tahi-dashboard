import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { SiteIndexContent } from './site-index-content'

export const metadata = { title: 'Site index — Tahi Dashboard' }

export default async function SiteIndexPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  return <SiteIndexContent />
}
