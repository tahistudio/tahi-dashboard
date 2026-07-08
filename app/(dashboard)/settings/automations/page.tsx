import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Settings - Tahi Dashboard' }

// Legacy route. The old standalone page was superseded by the in-shell
// settings section; keep the URL alive for old links and search results.
export default async function LegacyRedirectPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  redirect('/settings?section=automations')
}
