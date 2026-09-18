import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { guideSectionsFor } from '@/lib/dashboard-guide'
import { HelpContent } from './help-content'

export const metadata = { title: 'How this works - Tahi Dashboard' }

export default async function HelpPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  await requirePageFeature('help')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  const sections = guideSectionsFor(isAdmin ? 'team' : 'client')

  return <HelpContent sections={sections} isAdmin={isAdmin} />
}
